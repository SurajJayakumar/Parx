import torch
import torch.nn as nn
from torch.utils.data import Dataset, DataLoader
import glob, numpy as np

class SeqDataset(Dataset):
    def __init__(self, files, label):
        self.files = files
        self.label = label
    def __len__(self): return len(self.files)
    def __getitem__(self, i):
        x = np.load(self.files[i]).astype(np.float32)  # (T,D)
        x = torch.from_numpy(x)
        y = torch.tensor(self.label, dtype=torch.float32)
        return x, y

class PDNet(nn.Module):
    def __init__(self, in_dim, num_classes):
        super().__init__()
        self.conv1 = nn.Conv1d(in_dim, 128, kernel_size=3, padding=1)
        self.bn1 = nn.BatchNorm1d(128)
        self.conv2 = nn.Conv1d(128, 256, kernel_size=3, padding=1)
        self.bn2 = nn.BatchNorm1d(256)
        self.gru = nn.GRU(256, 128, batch_first=True, bidirectional=True)
        self.fc = nn.Sequential(nn.Linear(256, 128), nn.ReLU(), nn.Dropout(0.3), nn.Linear(128, num_classes))
    def forward(self, x):
        # x: (B, T, D)
        x = x.permute(0,2,1)  # (B, D, T)
        x = self.bn1(self.conv1(x))
        x = nn.functional.relu(x)
        x = self.bn2(self.conv2(x))
        x = nn.functional.relu(x)
        x = x.permute(0,2,1)  # (B, T, C)
        out, _ = self.gru(x)   # (B, T, 256)
        out = out.mean(dim=1)  # temporal average pooling -> (B,256)
        return self.fc(out)    # logits

# training loop sketch
def train(train_loader, val_loader, inp_dim, num_classes, epochs=50, device='cuda'):
    model = PDNet(inp_dim, num_classes).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    is_binary = num_classes == 1
    crit = nn.BCEWithLogitsLoss() if is_binary else nn.CrossEntropyLoss()
    use_amp = device.startswith('cuda') and torch.cuda.is_available()
    scaler = torch.amp.GradScaler('cuda', enabled=use_amp)
    for epoch in range(epochs):
        model.train()
        for x,y in train_loader:
            x = x.to(device, non_blocking=True)
            y = y.to(device, non_blocking=True)
            opt.zero_grad(set_to_none=True)
            with torch.amp.autocast('cuda', enabled=use_amp):
                logits = model(x)
                if is_binary:
                    y = y.view(-1, 1)
                    loss = crit(logits, y)
                else:
                    loss = crit(logits, y.long())
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
        # add validation, LR scheduling, early stopping here
    return model