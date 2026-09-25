"use server";

import { db } from "@/db/client";
import { voyagePortCalls } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import type { SofExtraction } from "@/lib/ingestion/schema";
import {
  ACCEPTED_MIME,
  MAX_UPLOAD_BYTES,
  buildPrompt,
  callGemini,
  normalizeExtraction,
  responseText,
} from "@/lib/ingestion/gemini";

/**
 * Read an uploaded SOF (PDF or photo) with Gemini and return a CANDIDATE
 * extraction for review. Nothing is written: the analyst reviews the result
 * and commits it through commitExtraction. The document is sent to Google's
 * Gemini API and is not stored by Voyantix.
 *
 * Config: GEMINI_API_KEY (required), GEMINI_MODEL (optional).
 */

const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.8-flash"];
const TIMEOUT_MS = 120_000;

export async function extractSofDocument(formData: FormData): Promise<ActionResult<SofExtraction>> {
  try {
    return await authorized<ActionResult<SofExtraction>>("operations.write", async (ctx) => {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return fail<SofExtraction>("NOT_CONFIGURED", "Document reading is not configured on this server (GEMINI_API_KEY).");
      }

      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) {
        return fail<SofExtraction>("VALIDATION_ERROR", "Choose a PDF or a photo of the statement of facts.");
      }
      if (!(ACCEPTED_MIME as readonly string[]).includes(file.type)) {
        return fail<SofExtraction>("VALIDATION_ERROR", "Only PDF, PNG, JPG or WEBP files can be read.");
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return fail<SofExtraction>("VALIDATION_ERROR", "The file is larger than 15 MB. Upload a smaller scan or split the document.");
      }

      // Hints from the port call, when the upload is for one.
      let hint: { operation: "LOAD" | "DISCHARGE" | null; timeZone: string | null } = { operation: null, timeZone: null };
      const portCallId = formData.get("portCallId");
      if (typeof portCallId === "string" && portCallId) {
        const [pc] = await db
          .select({ fn: voyagePortCalls.function, tz: voyagePortCalls.effectiveTimezone })
          .from(voyagePortCalls)
          .where(and(eq(voyagePortCalls.id, portCallId), eq(voyagePortCalls.organizationId, ctx.organizationId)));
        if (!pc) return fail<SofExtraction>("NOT_FOUND", "Port call not found.");
        hint = { operation: pc.fn, timeZone: pc.tz };
      }

      const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
      const prompt = buildPrompt(hint);
      const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : DEFAULT_MODELS;

      let lastMessage = "The document could not be read.";
      for (const model of models) {
        for (const withSchema of [true, false]) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
          let status: number;
          let body: unknown;
          try {
            ({ status, body } = await callGemini({ apiKey, model, mimeType: file.type, base64, prompt, withSchema, signal: controller.signal }));
          } catch (e) {
            clearTimeout(timer);
            lastMessage =
              e instanceof Error && e.name === "AbortError"
                ? "Reading the document took too long. Try again, or upload a smaller file."
                : "Could not reach the document reader. Try again in a moment.";
            break;
          }
          clearTimeout(timer);

          if (status === 200) {
            const text = responseText(body);
            if (!text) {
              lastMessage = "The reader returned nothing for this document. Check it is a readable SOF and try again.";
              break;
            }
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              lastMessage = "The reader's answer was not in the expected format. Try again.";
              break;
            }
            return ok<SofExtraction>(normalizeExtraction(parsed, model, new Date().toISOString()));
          }
          const apiMsg = (body as { error?: { message?: string } } | null)?.error?.message ?? "";
          if (status === 400 && withSchema) continue; // schema not accepted: retry without it
          if (status === 404) {
            lastMessage = `The reading model "${model}" is not available.`;
            break; // try the next model
          }
          if (status === 429) {
            return fail<SofExtraction>("RATE_LIMITED", "The document reader is busy (usage limit reached). Wait a minute and try again.");
          }
          if (status === 401 || status === 403) {
            return fail<SofExtraction>("NOT_CONFIGURED", "The document reader rejected the server's key. Check GEMINI_API_KEY.");
          }
          lastMessage = `The document reader failed (${status})${apiMsg ? `: ${apiMsg}` : ""}.`;
          break;
        }
      }
      return fail<SofExtraction>("EXTERNAL_FAILED", lastMessage);
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<SofExtraction>("FORBIDDEN", "You do not have permission to perform this action.");
    }
    throw e;
  }
}
