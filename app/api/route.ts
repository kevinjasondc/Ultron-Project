import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    console.log("USER MESSAGE:", message);

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: message,
    });

    const text = response.text;

    console.log("GEMINI RESPONSE:", text);

    return Response.json({
      response: text,
    });
  } catch (error) {
    console.error("GEMINI ERROR:", error);

    return Response.json(
      {
        error: "Failed to communicate with Gemini",
      },
      { status: 500 }
    );
  }
}