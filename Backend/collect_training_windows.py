import argparse
from pathlib import Path

import cv2
import numpy as np

from mediapipe_features import frame_to_feature, mp_holistic, mp_drawing


def mediapipe_detection(frame, holistic):
    image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image.flags.writeable = False
    results = holistic.process(image)
    image.flags.writeable = True
    image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR)
    return image, results


def draw_styled_landmarks(image, results):
    if results.pose_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.pose_landmarks,
            mp_holistic.POSE_CONNECTIONS,
        )
    if results.left_hand_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.left_hand_landmarks,
            mp_holistic.HAND_CONNECTIONS,
        )
    if results.right_hand_landmarks:
        mp_drawing.draw_landmarks(
            image,
            results.right_hand_landmarks,
            mp_holistic.HAND_CONNECTIONS,
        )


def next_sequence_index(out_dir: Path) -> int:
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = []
    for p in out_dir.glob("seq*.npy"):
        stem = p.stem
        try:
            existing.append(int(stem.replace("seq", "")))
        except ValueError:
            continue
    return (max(existing) + 1) if existing else 0



def collect_windows(actions, output_root, no_sequences=30, sequence_length=30, camera_id=0):
    output_root = Path(output_root)
    cap = cv2.VideoCapture(camera_id)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open webcam with camera_id={camera_id}")

    with mp_holistic.Holistic(min_detection_confidence=0.5, min_tracking_confidence=0.5) as holistic:
        for action in actions:
            action_dir = output_root / action
            seq_idx = next_sequence_index(action_dir)

            for sequence in range(seq_idx, seq_idx + no_sequences):
                sequence_feats = []

                for frame_num in range(sequence_length):
                    ret, frame = cap.read()
                    if not ret:
                        break

                    image, results = mediapipe_detection(frame, holistic)
                    draw_styled_landmarks(image, results)

                    if frame_num == 0:
                        cv2.putText(
                            image,
                            "STARTING COLLECTION",
                            (120, 200),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            1,
                            (0, 255, 0),
                            4,
                            cv2.LINE_AA,
                        )
                        cv2.putText(
                            image,
                            f"Collecting frames for {action} Video Number {sequence}",
                            (15, 30),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.6,
                            (0, 0, 255),
                            2,
                            cv2.LINE_AA,
                        )
                        cv2.imshow("OpenCV Feed", image)
                        cv2.waitKey(500)
                    else:
                        cv2.putText(
                            image,
                            f"Collecting frames for {action} Video Number {sequence}",
                            (15, 30),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.6,
                            (0, 0, 255),
                            2,
                            cv2.LINE_AA,
                        )
                        cv2.imshow("OpenCV Feed", image)

                    keypoints = frame_to_feature(results)
                    sequence_feats.append(keypoints)

                    if cv2.waitKey(10) & 0xFF == ord("q"):
                        cap.release()
                        cv2.destroyAllWindows()
                        return

                if len(sequence_feats) == sequence_length:
                    out_file = action_dir / f"seq{sequence}.npy"
                    np.save(out_file, np.stack(sequence_feats).astype(np.float32))
                    print(f"Saved {out_file}")

    cap.release()
    cv2.destroyAllWindows()


def parse_args():
    parser = argparse.ArgumentParser(description="Collect training windows from webcam with MediaPipe" )
    parser.add_argument("--actions", type=str, default="control", help="Comma-separated class labels")
    parser.add_argument("--output", type=str, default="data/seq", help="Output root for .npy windows", choices=["data/seq"])
    parser.add_argument("--sequences", type=int, default= 11, help="Number of sequences per action, ")
    parser.add_argument("--seq-len", type=int, default= 100, help="Frames per sequence")
    parser.add_argument("--camera-id", type=int, default=0, help="OpenCV camera index")
    return parser.parse_args()


def main():
    args = parse_args()
    actions = [x.strip() for x in args.actions.split(",") if x.strip()]
    if not actions:
        raise ValueError("No actions provided. Example: --actions pd,control")

    collect_windows(
        actions=actions,
        output_root=args.output,
        no_sequences=args.sequences,
        sequence_length=args.seq_len,
        camera_id=args.camera_id,
    )


if __name__ == "__main__":
    main()
