from pathlib import Path
import base64
from typing import Any

import cv2
import numpy as np
import onnxruntime as ort
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from mediapipe_features import frame_to_feature, mp_holistic
from model_train import PDNet

app = FastAPI(title="Parkinson Inference API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
PD_PT_PATH = BASE_DIR / "pdnet.pt"
PD_ONNX_PATH = BASE_DIR / "pdnet.onnx"
FALL_PT_PATH = BASE_DIR / "pdnet_fall.pt"
FALL_ONNX_PATH = BASE_DIR / "pdnet_fall.onnx"
DEFAULT_SEQ_LEN = 100


def _sigmoid(x: np.ndarray | float) -> float:
    x = float(x)
    return 1.0 / (1.0 + np.exp(-x))


def _fix_seq_len(feats: np.ndarray, seq_len: int) -> np.ndarray:
    if feats.ndim != 2:
        raise HTTPException(status_code=400, detail=f"features must be 2D (T, D), got shape {tuple(feats.shape)}")

    t, d = feats.shape
    if t <= 0 or d <= 0:
        raise HTTPException(status_code=400, detail="features shape must be (T>0, D>0)")

    if t > seq_len:
        feats = feats[-seq_len:]
    elif t < seq_len:
        pad = np.repeat(feats[[0]], seq_len - t, axis=0)
        feats = np.concatenate([pad, feats], axis=0)

    feats = feats.astype(np.float32, copy=False)
    if not np.isfinite(feats).all():
        raise HTTPException(status_code=400, detail="features contain NaN or Inf values")
    return feats


class SinglePredictor:
    def __init__(self, name: str, pt_path: Path, onnx_path: Path) -> None:
        self.name = name
        self.pt_path = pt_path
        self.onnx_path = onnx_path
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.use_cuda = self.device == "cuda"
        if self.use_cuda:
            torch.backends.cudnn.benchmark = True
            try:
                torch.set_float32_matmul_precision("high")
            except Exception:
                pass

        self.backend: str | None = None
        self.model: PDNet | None = None
        self.sess: ort.InferenceSession | None = None
        self.inp_dim: int | None = None
        self.model_error: str | None = None

        self._load_model()

    def _load_model(self) -> None:
        if self.pt_path.exists():
            try:
                state = torch.load(self.pt_path, map_location=self.device)
                if "conv1.weight" not in state:
                    raise ValueError(f"{self.pt_path.name} is missing conv1.weight; expected PDNet state_dict")

                inp_dim = int(state["conv1.weight"].shape[1])
                model = PDNet(in_dim=inp_dim, num_classes=1)
                model.load_state_dict(state)
                model.to(self.device)
                model.eval()

                self.model = model
                self.inp_dim = inp_dim
                self.backend = f"torch:{self.device}"
                return
            except Exception as exc:
                self.model_error = f"Failed to load {self.pt_path.name}: {exc}"

        if self.onnx_path.exists():
            try:
                providers: list[str]
                if ort.get_device().upper() == "GPU":
                    providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
                else:
                    providers = ["CPUExecutionProvider"]

                sess = ort.InferenceSession(str(self.onnx_path), providers=providers)
                self.sess = sess
                self.inp_dim = int(sess.get_inputs()[0].shape[-1])
                self.backend = f"onnx:{sess.get_providers()[0]}"
                return
            except Exception as exc:
                self.model_error = f"Failed to load {self.onnx_path.name}: {exc}"

        if self.model_error is None:
            self.model_error = (
                f"No model found for {self.name}. Expected {self.pt_path.name} or {self.onnx_path.name} in {BASE_DIR}"
            )

    def predict(self, seq: np.ndarray) -> float:
        if self.backend is None:
            raise HTTPException(status_code=503, detail=self.model_error)

        if self.inp_dim is None:
            raise HTTPException(status_code=503, detail="Model input dimension is unknown")

        if seq.shape[-1] != self.inp_dim:
            raise HTTPException(
                status_code=400,
                detail=f"Feature dimension mismatch: got D={seq.shape[-1]}, expected D={self.inp_dim}",
            )

        if self.model is not None:
            x = torch.from_numpy(seq[None, ...])
            if self.use_cuda:
                x = x.pin_memory().to(self.device, non_blocking=True)
            else:
                x = x.to(self.device)

            with torch.inference_mode(), torch.amp.autocast("cuda", enabled=self.use_cuda):
                logits = self.model(x)
            return _sigmoid(logits.detach().cpu().numpy().squeeze())

        if self.sess is not None:
            logits = self.sess.run(None, {self.sess.get_inputs()[0].name: seq[None, ...]})[0]
            return _sigmoid(np.asarray(logits).squeeze())

        raise HTTPException(status_code=503, detail=f"No active inference backend for {self.name}")


class Predictor:
    def __init__(self) -> None:
        self.pdnet = SinglePredictor("pdnet", PD_PT_PATH, PD_ONNX_PATH)
        self.pdnet_fall = SinglePredictor("pdnet_fall", FALL_PT_PATH, FALL_ONNX_PATH)

    @property
    def device(self) -> str:
        return self.pdnet.device

    def health(self) -> dict[str, Any]:
        return {
            "pdnet": {
                "status": "ok" if self.pdnet.backend else "degraded",
                "backend": self.pdnet.backend,
                "input_dim": self.pdnet.inp_dim,
                "model_error": self.pdnet.model_error,
            },
            "pdnet_fall": {
                "status": "ok" if self.pdnet_fall.backend else "degraded",
                "backend": self.pdnet_fall.backend,
                "input_dim": self.pdnet_fall.inp_dim,
                "model_error": self.pdnet_fall.model_error,
            },
        }

    def predict_both(self, seq: np.ndarray) -> tuple[float, float]:
        pd_prob = self.pdnet.predict(seq)
        fall_prob = self.pdnet_fall.predict(seq)
        return pd_prob, fall_prob


predictor = Predictor()


class PredictFramesRequest(BaseModel):
    frames: list[str] = Field(..., description="Base64-encoded JPEG/PNG frames")
    seq_len: int = Field(default=DEFAULT_SEQ_LEN, ge=16, le=300)


class PredictFeaturesRequest(BaseModel):
    features: list[list[float]] = Field(..., description="Sequence as T x D MediaPipe feature matrix")
    seq_len: int = Field(default=DEFAULT_SEQ_LEN, ge=16, le=300)


@app.get("/health")
async def health() -> dict[str, Any]:
    model_health = predictor.health()
    any_ok = any(model["status"] == "ok" for model in model_health.values())
    return {
        "status": "ok" if any_ok else "degraded",
        "device": predictor.device,
        "models": model_health,
    }


@app.post("/predict/features")
async def predict_features(req: PredictFeaturesRequest) -> dict[str, Any]:
    arr = np.asarray(req.features, dtype=np.float32)
    seq = _fix_seq_len(arr, req.seq_len)
    pd_prob, fall_prob = predictor.predict_both(seq)
    pd_detected = bool(pd_prob >= 0.5)
    fall_detected = bool(fall_prob >= 0.5)
    if fall_detected:
        severity = "high"
    elif pd_detected:
        severity = "medium"
    else:
        severity = "low"

    return {
        "pdnet_probability": float(pd_prob),
        "pdnet_detected": pd_detected,
        "pdnet_fall_probability": float(fall_prob),
        "pdnet_fall_detected": fall_detected,
        "fall_flag": fall_detected,
        "severity": severity,
        "parkinson_probability": float(pd_prob),
        "parkinson_detected": pd_detected,
        "backend": {
            "pdnet": predictor.pdnet.backend,
            "pdnet_fall": predictor.pdnet_fall.backend,
        },
        "seq_len_used": int(seq.shape[0]),
    }


def _frames_to_features(frames: list[str]) -> np.ndarray:
    feats: list[np.ndarray] = []
    with mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5) as hol:
        for img_b64 in frames:
            try:
                raw = base64.b64decode(img_b64)
                buf = np.frombuffer(raw, np.uint8)
                img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
                if img is None:
                    continue
                res = hol.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
                feats.append(frame_to_feature(res))
            except Exception:
                continue

    if not feats:
        raise HTTPException(status_code=400, detail="No valid frames decoded")

    return np.stack(feats).astype(np.float32, copy=False)


@app.post("/predict/frames")
async def predict_frames(req: PredictFramesRequest) -> dict[str, Any]:
    if not req.frames:
        raise HTTPException(status_code=400, detail="frames cannot be empty")

    feats = _frames_to_features(req.frames)
    seq = _fix_seq_len(feats, req.seq_len)
    pd_prob, fall_prob = predictor.predict_both(seq)
    pd_detected = bool(pd_prob >= 0.5)
    fall_detected = bool(fall_prob >= 0.5)
    if fall_detected:
        severity = "high"
    elif pd_detected:
        severity = "medium"
    else:
        severity = "low"

    return {
        "pdnet_probability": float(pd_prob),
        "pdnet_detected": pd_detected,
        "pdnet_fall_probability": float(fall_prob),
        "pdnet_fall_detected": fall_detected,
        "fall_flag": fall_detected,
        "severity": severity,
        "parkinson_probability": float(pd_prob),
        "parkinson_detected": pd_detected,
        "backend": {
            "pdnet": predictor.pdnet.backend,
            "pdnet_fall": predictor.pdnet_fall.backend,
        },
        "frames_received": len(req.frames),
        "frames_used": int(min(len(req.frames), req.seq_len)),
    }
