/**
 * Live camera barcode scanner (EAN-13, EAN-8, UPC-A, UPC-E) using ZXing.
 * Works in iPhone Safari and Android Chrome, but only on https:// pages (or localhost).
 */
import { useEffect, useRef } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { isValidBarcode, normalizeScannedCode } from "../barcode";

const FORMATS = [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E];

interface Props {
  onDetected: (code: string) => void;
  onError: (message: string) => void;
}

export function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, or type the number below.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found. Type the number below.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return "Couldn't start the camera. Type the number below.";
}

export function BarcodeScanner({ onDetected, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Keep the latest callbacks without restarting the camera when they change.
  const callbacks = useRef({ onDetected, onError });
  callbacks.current = { onDetected, onError };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      callbacks.current.onError("The camera only works on a secure (https://) page. Type the number below.");
      return;
    }

    let controls: IScannerControls | undefined;
    let done = false;
    const reader = new BrowserMultiFormatReader(new Map([[DecodeHintType.POSSIBLE_FORMATS, FORMATS]]));

    reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: "environment" } } },
        video,
        (result, _error, liveControls) => {
          if (!result || done) return; // no barcode in this frame yet
          const format = result.getBarcodeFormat() === BarcodeFormat.UPC_E ? "UPC_E" : "OTHER";
          const code = normalizeScannedCode(result.getText(), format);
          if (!isValidBarcode(code)) return; // misread: keep looking
          done = true;
          liveControls.stop();
          navigator.vibrate?.(60);
          callbacks.current.onDetected(code);
        },
      )
      .then((c) => {
        controls = c;
        if (done) c.stop(); // the screen closed while the camera was starting
      })
      .catch((err) => {
        if (!done) callbacks.current.onError(cameraErrorMessage(err));
      });

    return () => {
      done = true;
      controls?.stop();
    };
  }, []);

  // muted + playsInline are required for the live preview to play inside the page on iPhone.
  return <video ref={videoRef} className="scanner-video" muted playsInline autoPlay aria-label="Camera preview" />;
}
