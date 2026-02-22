import torch
from model_train import PDNet

def export_onnx(model, inp_dim, seq_len=30, out_path="pdnet.onnx"):
    model.eval()
    dummy = torch.randn(1, seq_len, inp_dim)
    torch.onnx.export(
        model,
        dummy,
        out_path,
        opset_version=12,
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch", 1: "time"}, "output": {0: "batch"}},
        dynamo=False,
    )