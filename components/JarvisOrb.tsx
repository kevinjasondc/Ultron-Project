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

  /*
   * VOICE SYSTEM
   */
  const voiceEnabledRef = useRef(true);
  const wakeWordActiveRef = useRef(true);
  const commandActiveRef = useRef(false);
  const recognitionRunningRef = useRef(false);
  const restartingRef = useRef(false);
  const destroyedRef = useRef(false);

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
      destroyedRef.current = true;
      voiceEnabledRef.current = false;
      wakeWordActiveRef.current = false;
      commandActiveRef.current = false;

      trackerRef.current?.stop();
      trackerRef.current = null;

      recognitionRef.current?.abort();
      recognitionRef.current = null;

      window.speechSynthesis?.cancel();

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
       * Stop recognition while ULTRON speaks.
       *
       * This prevents ULTRON from hearing
       * its own voice and triggering itself.
       */
      commandActiveRef.current = false;
      wakeWordActiveRef.current = false;

      recognitionRef.current?.abort();
      recognitionRunningRef.current = false;

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
          if (destroyedRef.current) return;

          setBrainState("idle");
          setTranscript("");

          /*
           * Return to wake-word mode.
           */
          wakeWordActiveRef.current = true;
          commandActiveRef.current = false;

          setTimeout(() => {
            if (
              voiceEnabledRef.current &&
              !destroyedRef.current
            ) {
              startWakeWordListening();
            }
          }, 700);
        };

        utterance.onerror = () => {
          if (destroyedRef.current) return;

          setBrainState("idle");

          wakeWordActiveRef.current = true;
          commandActiveRef.current = false;

          setTimeout(() => {
            if (
              voiceEnabledRef.current &&
              !destroyedRef.current
            ) {
              startWakeWordListening();
            }
          }, 700);
        };

        window.speechSynthesis.speak(utterance);
      } else {
        setBrainState("idle");

        wakeWordActiveRef.current = true;
        commandActiveRef.current = false;

        setTimeout(() => {
          if (
            voiceEnabledRef.current &&
            !destroyedRef.current
          ) {
            startWakeWordListening();
          }
        }, 700);
      }
    } catch (err) {
      console.error("Gemini request failed:", err);

      setBrainState("error");
      setResponse("Gemini connection failed.");

      commandActiveRef.current = false;
      wakeWordActiveRef.current = false;

      recognitionRef.current?.abort();
      recognitionRunningRef.current = false;

      setTimeout(() => {
        if (destroyedRef.current) return;

        setBrainState("idle");
        setTranscript("");

        wakeWordActiveRef.current = true;

        if (voiceEnabledRef.current) {
          startWakeWordListening();
        }
      }, 2500);
    }
  }, []);

  /*
   * COMMAND LISTENER
   *
   * After "HEY ULTRON" is detected,
   * this listens for the actual question.
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

    if (destroyedRef.current) return;

    commandActiveRef.current = true;
    wakeWordActiveRef.current = false;

    recognitionRef.current?.abort();
    recognitionRunningRef.current = false;

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      recognitionRunningRef.current = true;

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
        const command = finalText.trim();

        setTranscript(command);

        commandActiveRef.current = false;

        recognition.stop();

        void askGemini(command);
      }
    };

    recognition.onerror = (event) => {
      console.log(
        "Command recognition:",
        event.error
      );

      recognitionRunningRef.current = false;

      if (event.error === "not-allowed") {
        setError("MICROPHONE ACCESS DENIED");
        setBrainState("error");

        voiceEnabledRef.current = false;
        return;
      }

      if (
        event.error === "no-speech" ||
        event.error === "aborted"
      ) {
        commandActiveRef.current = false;
        wakeWordActiveRef.current = true;

        setBrainState("idle");
        setTranscript("");

        setTimeout(() => {
          if (
            voiceEnabledRef.current &&
            !destroyedRef.current
          ) {
            startWakeWordListening();
          }
        }, 700);

        return;
      }

      commandActiveRef.current = false;
      wakeWordActiveRef.current = true;

      setBrainState("idle");

      setTimeout(() => {
        if (
          voiceEnabledRef.current &&
          !destroyedRef.current
        ) {
          startWakeWordListening();
        }
      }, 700);
    };

    recognition.onend = () => {
      recognitionRunningRef.current = false;

      /*
       * If a command was successfully received,
       * Gemini is handling it.
       */
      if (!commandActiveRef.current) {
        return;
      }

      /*
       * If the user didn't say anything,
       * return to wake-word mode.
       */
      commandActiveRef.current = false;
      wakeWordActiveRef.current = true;

      setBrainState("idle");
      setTranscript("");

      setTimeout(() => {
        if (
          voiceEnabledRef.current &&
          !destroyedRef.current
        ) {
          startWakeWordListening();
        }
      }, 700);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (err) {
      console.log(
        "Command recognition start:",
        err
      );

      recognitionRunningRef.current = false;
    }
  }, [askGemini]);

  /*
   * WAKE WORD LISTENER
   *
   * IMPORTANT:
   *
   * We use ONE continuous recognition session.
   *
   * We do NOT repeatedly create a new
   * SpeechRecognition object every time
   * no-speech occurs.
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

      if (
        destroyedRef.current ||
        !voiceEnabledRef.current ||
        commandActiveRef.current
      ) {
        return;
      }

      /*
       * Don't start another listener if one
       * is already running.
       */
      if (recognitionRunningRef.current) {
        return;
      }

      wakeWordActiveRef.current = true;
      commandActiveRef.current = false;

      const recognition = new SpeechRecognition();

      /*
       * KEY CHANGE:
       *
       * Keep the wake listener continuous.
       */
      recognition.continuous = true;

      /*
       * We need interim results so the wake word
       * can be detected quickly.
       */
      recognition.interimResults = true;

      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        recognitionRunningRef.current = true;

        setBrainState("idle");
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

        if (!heardText) return;

        console.log(
          "ULTRON heard:",
          heardText
        );

        /*
         * Accept:
         *
         * hey ultron
         * hey, ultron
         * hey ultra n
         * hey ultra
         *
         * The looser matching helps when
         * Chrome transcribes "Ultron" imperfectly.
         */
        const wakeWord =
          /\bhey[\s,.-]*(ultron|ultra[\s-]*n|ultra)\b/i;

        if (!wakeWord.test(heardText)) {
          return;
        }

        console.log(
          "========== ULTRON WAKE WORD DETECTED =========="
        );

        /*
         * Switch from wake-word mode to
         * command mode.
         */
        wakeWordActiveRef.current = false;
        commandActiveRef.current = true;

        setTranscript("HEY ULTRON");
        setBrainState("listening");

        /*
         * Stop the continuous wake listener.
         */
        recognition.stop();

        recognitionRunningRef.current = false;

        /*
         * Give the browser a moment to close
         * the old recognition session before
         * opening the command listener.
         */
        setTimeout(() => {
          if (
            !destroyedRef.current &&
            voiceEnabledRef.current &&
            commandActiveRef.current
          ) {
            startCommandListening();
          }
        }, 350);
      };

      recognition.onerror = (event) => {
        console.log(
          "Wake word recognition:",
          event.error
        );

        recognitionRunningRef.current = false;

        if (event.error === "not-allowed") {
          setError("MICROPHONE ACCESS DENIED");
          setBrainState("error");

          voiceEnabledRef.current = false;
          return;
        }

        /*
         * These are normal browser events.
         *
         * We don't immediately create another
         * recognition instance here.
         */
        if (
          event.error === "no-speech" ||
          event.error === "aborted"
        ) {
          return;
        }

        setTimeout(() => {
          if (
            voiceEnabledRef.current &&
            wakeWordActiveRef.current &&
            !destroyedRef.current
          ) {
            startWakeWordListening();
          }
        }, 1000);
      };

      recognition.onend = () => {
        recognitionRunningRef.current = false;

        /*
         * If wake mode is still active, restart
         * only after the service actually ended.
         *
         * This prevents multiple recognition
         * instances from fighting each other.
         */
        if (
          voiceEnabledRef.current &&
          wakeWordActiveRef.current &&
          !commandActiveRef.current &&
          !destroyedRef.current &&
          !restartingRef.current
        ) {
          restartingRef.current = true;

          setTimeout(() => {
            restartingRef.current = false;

            if (
              voiceEnabledRef.current &&
              wakeWordActiveRef.current &&
              !commandActiveRef.current &&
              !destroyedRef.current
            ) {
              startWakeWordListening();
            }
          }, 800);
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch (err) {
        console.log(
          "Wake recognition start:",
          err
        );

        recognitionRunningRef.current = false;
      }
    }, [startCommandListening]);

  /*
   * START WAKE WORD SYSTEM
   */
  useEffect(() => {
    destroyedRef.current = false;
    voiceEnabledRef.current = true;
    wakeWordActiveRef.current = true;
    commandActiveRef.current = false;

    const timer = setTimeout(() => {
      startWakeWordListening();
    }, 1000);

    return () => {
      clearTimeout(timer);

      destroyedRef.current = true;

      voiceEnabledRef.current = false;
      wakeWordActiveRef.current = false;
      commandActiveRef.current = false;

      recognitionRef.current?.abort();
      recognitionRef.current = null;

      recognitionRunningRef.current = false;

      window.speechSynthesis?.cancel();
    };
  }, [startWakeWordListening]);

  /*
   * MANUAL VOICE TOGGLE
   *
   * V key / button still works.
   */
  const toggleVoice = useCallback(() => {
    if (
      brainState === "listening" ||
      brainState === "thinking" ||
      brainState === "speaking"
    ) {
      voiceEnabledRef.current = false;
      wakeWordActiveRef.current = false;
      commandActiveRef.current = false;

      recognitionRef.current?.abort();
      recognitionRef.current = null;

      recognitionRunningRef.current = false;

      window.speechSynthesis?.cancel();

      setBrainState("idle");
      setTranscript("");

      return;
    }

    voiceEnabledRef.current = true;
    wakeWordActiveRef.current = true;
    commandActiveRef.current = false;

    setError(null);

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

        {/* VOICE */}
        <div className="hud-row">
          <button
            type="button"
            className="hud-btn"
            onClick={toggleVoice}
          >
            {voiceEnabledRef.current
              ? "VOICE ACTIVE"
              : "VOICE OFF"}
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
