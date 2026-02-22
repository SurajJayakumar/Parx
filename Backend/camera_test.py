import argparse
import time

import cv2


def parse_args():
    parser = argparse.ArgumentParser(description="Basic OpenCV camera test")
    parser.add_argument("--camera-id", type=int, default=1, help="Camera index (0, 1, 2, ...)")
    parser.add_argument("--width", type=int, default=1280, help="Requested capture width")
    parser.add_argument("--height", type=int, default=720, help="Requested capture height")
    return parser.parse_args()


def main():
    args = parse_args()

    cap = cv2.VideoCapture(args.camera_id)
    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open camera_id={args.camera_id}. Try another id like --camera-id 1"
        )

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, args.width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, args.height)

    print(f"Opened camera_id={args.camera_id}. Press 'q' to quit.")

    prev_t = time.time()
    while True:
        ret, frame = cap.read()
        if not ret:
            print("Failed to read frame.")
            break

        now_t = time.time()
        fps = 1.0 / max(now_t - prev_t, 1e-6)
        prev_t = now_t

        cv2.putText(
            frame,
            f"camera_id={args.camera_id}  FPS={fps:.1f}",
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 255, 0),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            frame,
            "Press q to quit",
            (10, 60),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )

        cv2.imshow("Camera Test", frame)

        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
