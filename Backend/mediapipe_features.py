# mediapipe_features.py
import cv2
import numpy as np
import mediapipe as mp

try:
    from mediapipe.python.solutions import holistic as mp_holistic
    from mediapipe.python.solutions import drawing_utils as mp_drawing
except Exception:
    try:
        mp_holistic = mp.solutions.holistic
        mp_drawing = mp.solutions.drawing_utils
    except AttributeError as exc:
        raise ImportError(
            "Could not import MediaPipe Holistic. "
            "Install/upgrade mediapipe and use a compatible build."
        ) from exc

# indices (mediapipe pose): left_hip=23, right_hip=24, left_shoulder=11, right_shoulder=12
LH_IP = 23
RH_IP = 24
LS = 11
RS = 12

def landmarks_to_array(landmarks):
    # returns Nx4 array (x,y,z,visibility)
    return np.array([[lm.x, lm.y, lm.z, getattr(lm, 'visibility', 1.0)] for lm in landmarks])

def normalize_pose(pose_xyzv):
    # pose_xyzv: (33,4)
    left_hip = pose_xyzv[LH_IP, :3]
    right_hip = pose_xyzv[RH_IP, :3]
    hip_center = (left_hip + right_hip) / 2.0
    # torso length proxy (distance between shoulders and hips)
    shoulders = (pose_xyzv[LS, :3] + pose_xyzv[RS, :3]) / 2.0
    torso_len = np.linalg.norm(shoulders - hip_center) + 1e-6
    # root-center and scale
    coords = pose_xyzv[:, :3] - hip_center
    coords = coords / torso_len
    vis = pose_xyzv[:, 3:4]
    return np.concatenate([coords, vis], axis=1)  # (33,4)

def angle(a, b, c):
    # angle at b formed by points a-b-c
    ba = a - b
    bc = c - b
    cosang = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-8)
    cosang = np.clip(cosang, -1.0, 1.0)
    return np.arccos(cosang)

def compute_angles(pose_coords):
    # pose_coords: (33,3) root-centered normalized coords
    # return list of angles for key joints: hips, knees, shoulders, elbows
    idx = {
        "left_shoulder":11, "right_shoulder":12,
        "left_elbow":13, "right_elbow":14,
        "left_wrist":15, "right_wrist":16,
        "left_hip":23, "right_hip":24,
        "left_knee":25, "right_knee":26, "left_ankle":27, "right_ankle":28
    }
    angles = []
    # shoulder-elbow-wrist
    angles.append(angle(pose_coords[idx["left_shoulder"]], pose_coords[idx["left_elbow"]], pose_coords[idx["left_wrist"]]))
    angles.append(angle(pose_coords[idx["right_shoulder"]], pose_coords[idx["right_elbow"]], pose_coords[idx["right_wrist"]]))
    # hip-knee-ankle
    angles.append(angle(pose_coords[idx["left_hip"]], pose_coords[idx["left_knee"]], pose_coords[idx["left_ankle"]]))
    angles.append(angle(pose_coords[idx["right_hip"]], pose_coords[idx["right_knee"]], pose_coords[idx["right_ankle"]]))
    # torso yaw proxy (shoulder vector)
    shoulder_vec = pose_coords[idx["right_shoulder"]] - pose_coords[idx["left_shoulder"]]
    angles.append(np.arctan2(shoulder_vec[1], shoulder_vec[0]))  # orientation
    return np.array(angles)  # small vector

def hand_features(hand_landmarks):
    # hand_landmarks is list of 21 or None
    if hand_landmarks is None:
        return np.zeros(10)
    arr = np.array([[lm.x, lm.y, lm.z] for lm in hand_landmarks])
    # example features: tip distances and std
    thumb_tip = arr[4]
    index_tip = arr[8]
    dist = np.linalg.norm((thumb_tip - index_tip))
    tips = arr[[4,8,12,16,20]]
    spread = np.std(tips, axis=0).mean()
    velocity_placeholder = 0.0
    return np.array([dist, spread, velocity_placeholder, np.mean(arr[:,0]), np.mean(arr[:,1]),
                     np.min(arr[:,0]), np.max(arr[:,0]), np.min(arr[:,1]), np.max(arr[:,1]), arr[8,2]])

def frame_to_feature(results):
    # results: Mediapipe holistic results
    # returns 1D feature vector for a single frame
    pose = landmarks_to_array(results.pose_landmarks.landmark) if results.pose_landmarks else np.zeros((33,4))
    pose_norm = normalize_pose(pose)  # (33,4)
    angles = compute_angles(pose_norm[:,:3])
    # basic joint coords flattened but keep just x,y for speed
    coords2d = pose_norm[:,:2].flatten()  # 33*2 = 66
    left_hand = results.left_hand_landmarks.landmark if results.left_hand_landmarks else None
    right_hand = results.right_hand_landmarks.landmark if results.right_hand_landmarks else None
    lh_feat = hand_features(left_hand)
    rh_feat = hand_features(right_hand)
    vis = pose_norm[:,3]
    feat = np.concatenate([coords2d, angles, lh_feat, rh_feat, vis])
    return feat.astype(np.float32)  # example dimension ~66 + 5 +10 +10 +33 = 124
