import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { message } = await request.json();

    console.log("USER MESSAGE:", message);

    if (!message || typeof message !== "string") {
      return Response.json(
        {
          error: "No message was provided.",
        },
        { status: 400 }
      );
    }

    const interaction = await ai.interactions.create({
      model: "gemini-3.6-flash",
      input: message,
    });

    console.log("GEMINI RESPONSE:", interaction.output_text);

    return Response.json({
      response: interaction.output_text,
    });
  } catch (error) {
    console.error("GEMINI ERROR:", error);

    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return Response.json(
      {
        error: errorMessage,
      },
      { status: 500 }
    );
  }
}
