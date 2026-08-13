import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "v1",
  },
});

export async function POST(req: Request) {
  try {
    const { message } = await req.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required." },
        { status: 400 },
      );
    }

    const interaction = await ai.interactions.create({
      model: "gemini-3.6-flash",
      input: `You are ULTRON, an advanced futuristic AI assistant.

Personality:
- Calm
- Intelligent
- Confident
- Concise
- Helpful
- Futuristic

Do not constantly say that you are ULTRON.
Answer the user's request naturally.

USER:
${message}`,
    });

    return NextResponse.json({
      response:
        interaction.output_text ||
        "I received your request, but I have no response.",
    });
  } catch (error) {
    console.error("Gemini API error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Gemini request failed.",
      },
      { status: 500 },
    );
  }
}