"use client";

import { useRef, useState } from "react";

type SpeechRecognitionEventLike = {
  results: {
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onstart: () => void;
  onend: () => void;
  onresult: (event: SpeechRecognitionEventLike) => void;
  onerror: (event: { error: string }) => void;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

export default function VoiceAssistant() {
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");

  const speak = (text: string) => {
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);

    utterance.rate = 0.9;
    utterance.pitch = 0.8;
    utterance.volume = 1;

    window.speechSynthesis.speak(utterance);
  };

  const askGemini = async (message: string) => {
    try {
      setResponse("THINKING...");

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Gemini request failed");
      }

      const reply = data.response;

      setResponse(reply);
      speak(reply);
    } catch (error) {
      console.error("Gemini request error:", error);

      const errorMessage =
        "I'm sorry, I couldn't process that request.";

      setResponse(errorMessage);
      speak(errorMessage);
    }
  };

  const startListening = () => {
    const SpeechRecognition =
      (window as unknown as {
        SpeechRecognition?: SpeechRecognitionConstructor;
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).SpeechRecognition ||
      (window as unknown as {
        webkitSpeechRecognition?: SpeechRecognitionConstructor;
      }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(
        "Speech recognition is not supported in this browser. Try Google Chrome.",
      );
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setListening(true);
      setResponse("LISTENING...");
    };

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript;

      setTranscript(text);

      askGemini(text);
    };

    recognition.onerror = (event) => {
      console.error("Speech recognition error:", event.error);
      setResponse(`VOICE ERROR: ${event.error}`);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "30px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        textAlign: "center",
        color: "#ff3333",
        fontFamily: "monospace",
      }}
    >
      <button
        type="button"
        onClick={listening ? stopListening : startListening}
        style={{
          padding: "12px 24px",
          border: "1px solid #ff3333",
          background: "rgba(40, 0, 0, 0.85)",
          color: "#ff3333",
          textShadow: "0 0 8px rgba(255, 50, 50, 0.8)",
          boxShadow: "0 0 12px rgba(255, 50, 50, 0.35)",
          cursor: "pointer",
          fontFamily: "monospace",
          fontSize: "14px",
        }}
      >
        {listening ? "🔴 STOP LISTENING" : "🎤 ACTIVATE ULTRON"}
      </button>

      {transcript && (
        <div style={{ marginTop: "10px" }}>
          YOU: {transcript}
        </div>
      )}

      {response && (
        <div style={{ marginTop: "8px" }}>
          ULTRON: {response}
        </div>
      )}
    </div>
  );
}
