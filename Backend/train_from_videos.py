from pathlib import Path
import torch
import numpy as np
from torch.utils.data import DataLoader, ConcatDataset
from torch.nn.utils.rnn import pad_sequence
from model_train import SeqDataset, train
from export_onnx import export_onnx


def pad_collate(batch):
    xs, ys = zip(*batch)
    x_padded = pad_sequence(xs, batch_first=True)  # (B, T_max, D)
    y = torch.stack(ys)
    return x_padded, y

pd_files = [str(x) for x in Path("data/seq/pd").glob("*.npy")]
ctrl_files = [str(x) for x in Path("data/seq/control").glob("*.npy")]
if not pd_files or not ctrl_files:
    raise RuntimeError(
        "No .npy training windows found for one or both classes. "
        "Expected files in data/seq/pd and data/seq/control."
    )

print(f"windows -> pd: {len(pd_files)}, control: {len(ctrl_files)}")
ds = ConcatDataset([SeqDataset(pd_files, 1.0), SeqDataset(ctrl_files, 0.0)])

device = "cuda" if torch.cuda.is_available() else "cpu"
use_cuda = device == "cuda"
if use_cuda:
    torch.backends.cudnn.benchmark = True

loader = DataLoader(
    ds,
    batch_size=64 if use_cuda else 16,
    shuffle=True,
    drop_last=False,
    collate_fn=pad_collate,
    num_workers=4 if use_cuda else 0,
    pin_memory=use_cuda,
    persistent_workers=use_cuda,
)

first_file = pd_files[0] if pd_files else ctrl_files[0]
inp_dim = int(np.load(first_file).shape[-1])
x0, _ = next(iter(loader))
model = train(loader, loader, inp_dim=inp_dim, num_classes=1, epochs=20, device=device)

torch.save(model.state_dict(), "pdnet.pt")
export_onnx(model, inp_dim=inp_dim, seq_len=int(x0.shape[1]), out_path="pdnet.onnx")
print("done")