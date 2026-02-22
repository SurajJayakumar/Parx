import os
import cv2
import numpy as np
from mediapipe_features import frame_to_feature, mp_holistic

def process_video_to_windows(video_path, out_dir, window_size=30, step=15):
    cap = cv2.VideoCapture(video_path)
    features = []
    with mp_holistic.Holistic(static_image_mode=False,
                              min_detection_confidence=0.5,
                              min_tracking_confidence=0.5) as hol:
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = hol.process(image)
            feat = frame_to_feature(results)
            features.append(feat)
    cap.release()
    features = np.stack(features)  # (N, D)
    # sliding windows
    i = 0
    idx = 0
    os.makedirs(out_dir, exist_ok=True)
    while i + window_size <= len(features):
        win = features[i:i+window_size]
        np.save(os.path.join(out_dir, f"seq{idx}.npy"), win)
        idx += 1
        i += step
    return idx  # number of windows saved