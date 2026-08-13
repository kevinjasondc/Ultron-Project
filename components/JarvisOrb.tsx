"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/lib/orbScene";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";

type CameraState = "off" | "starting" | "on" | "error";

type BrainState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

const MODE_LABEL: Record<TrackerStatus["mode"], string> = {
  idle: "STANDBY",
  spin: "SPIN",
  zoom: "ZOOM",
};

export default function JarvisOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);

  // Wake-word mode
  const wakeWordModeRef = useRef(true);
  const commandModeRef = useRef(false);
  const restartingRecognitionRef = useRef(false);

  const [camera, setCamera] = useState<CameraState>("off");

  const [status, setStatus] = useState<TrackerStatus>({
    hands: 0,
    mode: "idle",
  });

  const [error, setError] = useState<string | null>(null);

  const [brainState, setBrainState] =
    useState<BrainState>("idle");

  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");

  /*
   * THREE.JS ORB
   */
  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const scene = createOrbScene(container);

    sceneRef.current = scene;

    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;

      recognitionRef.current?.stop();
      recognitionRef.current = null;

      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  /*
   * GEMINI
   */
  const askGemini = useCallback(async (message: string) => {
    if (!message.trim()) return;

    setBrainState("thinking");
    setResponse("");

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          message,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.error || "Gemini request failed"
        );
      }

      const answer =
        data.response || "I have no response.";

      setResponse(answer);
      setBrainState("speaking");

      /*
       * TEXT TO SPEECH
       */
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();

        const utterance =
          new SpeechSynthesisUtterance(answer);

        utterance.rate = 1;
        utterance.pitch = 0.9;
        utterance.volume = 1;

        utterance.onend = () => {
          setBrainState("idle");

          // Return to wake-word listening
          commandModeRef.current = false;
          wakeWordModeRef.current = true;

          setTranscript("");

          setTimeout(() => {
            startWakeWordListening();
          }, 500);
        };

        window.speechSynthesis.speak(utterance);
      } else {
        setBrainState("idle");

        commandModeRef.current = false;
        wakeWordModeRef.current = true;

        setTimeout(() => {
          startWakeWordListening();
        }, 500);
      }
    } catch (err) {
      console.error("Gemini request failed:", err);

      setBrainState("error");
      setResponse("Gemini connection failed.");

      commandModeRef.current = false;
      wakeWordModeRef.current = true;

      setTimeout(() => {
        setBrainState("idle");

        startWakeWordListening();
      }, 2500);
    }
  }, []);

  /*
   * COMMAND LISTENER
   */
  const startCommandListening = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        "VOICE INPUT NOT SUPPORTED IN THIS BROWSER"
      );
      return;
    }

    recognitionRef.current?.stop();

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    commandModeRef.current = true;
    wakeWordModeRef.current = false;

    recognition.onstart = () => {
      setBrainState("listening");
      setTranscript("");
      setError(null);
    };

    recognition.onresult = (event) => {
      let finalText = "";

      for (
        let i = event.resultIndex;
        i < event.results.length;
        i++
      ) {
        const text =
          event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalText += text;
        } else {
          setTranscript(text);
        }
      }

      if (finalText.trim()) {
        setTranscript(finalText);

        commandModeRef.current = false;

        void askGemini(finalText);
      }
    };

    recognition.onerror = (event) => {
      console.error(
        "Command recognition error:",
        event.error
      );

      commandModeRef.current = false;

      if (event.error === "not-allowed") {
        setError("MICROPHONE ACCESS DENIED");
        setBrainState("error");
        return;
      }

      setBrainState("idle");

      setTimeout(() => {
        startWakeWordListening();
      }, 500);
    };

    recognition.onend = () => {
      if (commandModeRef.current) {
        commandModeRef.current = false;

        setTimeout(() => {
          startWakeWordListening();
        }, 500);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.error(
        "Command recognition start failed:",
        err
      );
    }
  }, [askGemini]);

  /*
   * WAKE WORD LISTENER
   */
  const startWakeWordListening =
    useCallback(() => {
      const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setError(
          "VOICE INPUT NOT SUPPORTED IN THIS BROWSER"
        );
        return;
      }

      // Don't start another recognition session
      if (restartingRecognitionRef.current) {
        return;
      }

      recognitionRef.current?.stop();

      const recognition = new SpeechRecognition();

      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      wakeWordModeRef.current = true;
      commandModeRef.current = false;

      recognition.onstart = () => {
        setBrainState("idle");
        setTranscript("");
        setError(null);
      };

      recognition.onresult = (event) => {
        let heardText = "";

        for (
          let i = event.resultIndex;
          i < event.results.length;
          i++
        ) {
          heardText +=
            " " +
            event.results[i][0].transcript;
        }

        heardText = heardText
          .trim()
          .toLowerCase();

        console.log(
          "ULTRON wake listener heard:",
          heardText
        );

        /*
         * Detect:
         *
         * hey ultron
         * hey, ultron
         * hey ultra
         * hey ultra n
         */
        const wakeWord =
          /\bhey\s+(ultron|ultra\s*n)\b/i;

        if (wakeWord.test(heardText)) {
          console.log(
            "ULTRON WAKE WORD DETECTED"
          );

          wakeWordModeRef.current = false;

          setTranscript("HEY ULTRON");
          setBrainState("listening");

          recognition.stop();

          // Now listen for the actual command
          setTimeout(() => {
            startCommandListening();
          }, 250);
        }
      };

      recognition.onerror = (event) => {
        console.log(
          "Wake word listener:",
          event.error
        );

        if (event.error === "not-allowed") {
          setError("MICROPHONE ACCESS DENIED");
          setBrainState("error");
          return;
        }

        /*
         * no-speech is normal.
         * Chrome stops recognition when nothing
         * is heard, so simply restart it.
         */
        if (
          event.error === "no-speech" ||
          event.error === "aborted"
        ) {
          return;
        }

        setTimeout(() => {
          startWakeWordListening();
        }, 500);
      };

      recognition.onend = () => {
        if (
          wakeWordModeRef.current &&
          !commandModeRef.current
        ) {
          restartingRecognitionRef.current =
            true;

          setTimeout(() => {
            restartingRecognitionRef.current =
              false;

            startWakeWordListening();
          }, 300);
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch (err) {
        console.log(
          "Wake word recognition already running."
        );
      }
    }, [startCommandListening]);

  /*
   * START WAKE WORD SYSTEM AUTOMATICALLY
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      startWakeWordListening();
    }, 1000);

    return () => {
      clearTimeout(timer);

      wakeWordModeRef.current = false;
      commandModeRef.current = false;

      recognitionRef.current?.stop();
    };
  }, [startWakeWordListening]);

  /*
   * MANUAL VOICE TOGGLE
   */
  const toggleVoice = useCallback(() => {
    if (
      brainState === "listening" ||
      brainState === "thinking" ||
      brainState === "speaking"
    ) {
      wakeWordModeRef.current = false;
      commandModeRef.current = false;

      recognitionRef.current?.stop();

      window.speechSynthesis?.cancel();

      setBrainState("idle");
      setTranscript("");

      return;
    }

    wakeWordModeRef.current = true;
    commandModeRef.current = false;

    startWakeWordListening();
  }, [brainState, startWakeWordListening]);

  /*
   * GESTURES
   */
  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();

    trackerRef.current = null;

    setCamera("off");

    setStatus({
      hands: 0,
      mode: "idle",
    });
  }, []);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;

    if (
      !video ||
      !overlay ||
      trackerRef.current
    ) {
      return;
    }

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(
      video,
      overlay,
      {
        onRotate: (dt, dp) => {
          sceneRef.current?.rotateBy(
            dt,
            dp
          );
        },

        onZoom: (factor) => {
          sceneRef.current?.zoomBy(
            factor
          );
        },

        onStatus: setStatus,
      }
    );

    trackerRef.current = tracker;

    try {
      await tracker.start();

      setCamera("on");
    } catch (err) {
      trackerRef.current = null;

      tracker.stop();

      setCamera("error");

      setError(
        err instanceof DOMException &&
          err.name === "NotAllowedError"
          ? "CAMERA ACCESS DENIED"
          : "TRACKING INIT FAILED"
      );
    }
  }, []);

  const toggleGestures = useCallback(() => {
    if (trackerRef.current) {
      stopGestures();
    } else {
      void startGestures();
    }
  }, [
    startGestures,
    stopGestures,
  ]);

  /*
   * KEYBOARD
   */
  useEffect(() => {
    const onKey = (
      e: KeyboardEvent
    ) => {
      switch (e.key) {
        case "+":
        case "=":
          sceneRef.current?.zoomIn();
          break;

        case "-":
        case "_":
          sceneRef.current?.zoomOut();
          break;

        case "r":
        case "R":
          sceneRef.current?.resetView();
          break;

        case "g":
        case "G":
          toggleGestures();
          break;

        case "v":
        case "V":
          toggleVoice();
          break;
      }
    };

    window.addEventListener(
      "keydown",
      onKey
    );

    return () => {
      window.removeEventListener(
        "keydown",
        onKey
      );
    };
  }, [
    toggleGestures,
    toggleVoice,
  ]);

  const cameraOn = camera === "on";

  const brainLabel = {
    idle: "SAY HEY ULTRON",
    listening: "LISTENING",
    thinking: "THINKING",
    speaking: "ULTRON ONLINE",
    error: "SYSTEM ERROR",
  }[brainState];

  return (
    <>
      <div
        ref={containerRef}
        className="orb-root"
      />

      <div className="overlay-vignette" />
      <div className="overlay-grain" />
      <div className="overlay-scanlines" />

      <div className="hud hud-title">
        U.L.T.R.O.N.
      </div>

      {/* BRAIN STATUS */}
      <div
        className={`ultron-brain brain-${brainState}`}
      >
        <div className="brain-status">
          <span className="brain-dot" />
          {brainLabel}
        </div>

        {transcript && (
          <div className="brain-transcript">
            <span>YOU:</span>{" "}
            {transcript}
          </div>
        )}

        {response && (
          <div className="brain-response">
            <span>ULTRON:</span>

            <p>{response}</p>
          </div>
        )}
      </div>

      <div className="hud hud-hint">
        <div>
          <span className="key">
            DRAG
          </span>{" "}
          spin&nbsp;&nbsp;

          <span className="key">
            SCROLL
          </span>{" "}
          zoom
        </div>

        {cameraOn ? (
          <div>
            <span className="key">
              PINCH + MOVE
            </span>{" "}
            spin&nbsp;&nbsp;

            <span className="key">
              PINCH BOTH HANDS ± SPREAD
            </span>{" "}
            zoom
          </div>
        ) : (
          <div>
            <span className="key">
              G
            </span>{" "}
            hand gestures&nbsp;&nbsp;

            <span className="key">
              R
            </span>{" "}
            reset&nbsp;&nbsp;

            <span className="key">
              V
            </span>{" "}
            voice
          </div>
        )}
      </div>

      <div className="hud hud-controls">
        <div
          className={`camera-panel${
            cameraOn
              ? " visible"
              : ""
          }`}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            className="camera-video"
          />

          <canvas
            ref={overlayRef}
            width={208}
            height={156}
            className="camera-overlay"
          />

          <div className="camera-status">
            {status.hands > 0
              ? `${status.hands} HAND${
                  status.hands > 1
                    ? "S"
                    : ""
                } · ${
                  MODE_LABEL[
                    status.mode
                  ]
                }`
              : "SHOW HANDS"}
          </div>
        </div>

        {error && (
          <div className="hud-error">
            {error}
          </div>
        )}

        {/* VOICE BUTTON */}
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            onClick={toggleVoice}
          >
            {brainState ===
            "listening"
              ? "STOP LISTENING"
              : "VOICE ACTIVE"}
          </button>
        </div>

        {/* GESTURES */}
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            aria-pressed={cameraOn}
            onClick={
              toggleGestures
            }
            disabled={
              camera ===
              "starting"
            }
          >
            {camera ===
            "starting"
              ? "INITIALIZING…"
              : cameraOn
              ? "GESTURES ON"
              : "GESTURES OFF"}
          </button>
        </div>

        {/* CAMERA / ZOOM CONTROLS */}
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            onClick={() =>
              sceneRef.current?.zoomIn()
            }
            aria-label="Zoom in"
          >
            +
          </button>

          <button
            type="button"
            className="hud-btn"
            onClick={() =>
              sceneRef.current?.zoomOut()
            }
            aria-label="Zoom out"
          >
            −
          </button>

          <button
            type="button"
            className="hud-btn"
            onClick={() =>
              sceneRef.current?.resetView()
            }
          >
            RESET
          </button>
        </div>
      </div>
    </>
  );
}
