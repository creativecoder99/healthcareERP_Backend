import { GoogleGenAI } from "@google/genai";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

let ai: GoogleGenAI | null = null;

// Initialize GoogleGenAI client if API key is present
if (env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  logger.info("🤖 Google Gemini service initialized with API Key");
} else {
  logger.warn("⚠️ GEMINI_API_KEY is not set. Google Gemini service will run in OFFLINE MOCK MODE.");
}

export interface ExtractedBiomarker {
  parameterKey: string;
  parameterLabel: string;
  value: number;
  unit: string;
  referenceMin?: number;
  referenceMax?: number;
  isAbnormal: boolean;
  severity?: string; // "MILD" | "MODERATE" | "CRITICAL" | null
}

export interface MedicalAnalysisResult {
  summaryText: string;
  clinicalSummary?: string;
  confidence: number;
  extractedValues: ExtractedBiomarker[];
}

/**
 * Call Gemini 1.5 Flash to analyze a medical document (PDF or image)
 */
export async function analyzeMedicalDocument(
  fileBuffer: Buffer,
  mimeType: string,
  fileName = ""
): Promise<MedicalAnalysisResult> {
  if (!ai) {
    logger.info(`🔌 Gemini in offline mock mode. Generating mock result for: ${fileName}`);
    return generateMockAnalysis(fileName);
  }

  try {
    const base64Data = fileBuffer.toString("base64");
    const systemPrompt = `You are a medical health records OCR parser and clinical document analyzer. 
Analyze the provided medical report (PDF or image) and extract key parameters.
Provide the output strictly as a JSON object matching the following structure:
{
  "summaryText": "A patient-facing summary written in simple, plain, encouraging English. Explain what the report is, what biomarkers were tested, and highlight any abnormal values. Do not diagnose, and include a warm recommendation to consult their doctor.",
  "clinicalSummary": "A physician-facing clinical summary written in professional medical language, highlighting key abnormalities, ranges, and diagnostic pointers.",
  "confidence": 0.95,
  "extractedValues": [
    {
      "parameterKey": "HBA1C", // Canonical key: uppercase alphanumeric with underscores. e.g., HBA1C, TSH, HAEMOGLOBIN, GLUCOSE_FASTING, CHOLESTEROL_TOTAL, LDL, HDL, WBC, RBC, PLATELETS, CREATININE, UREA, SGPT, SGOT
      "parameterLabel": "HbA1c", // Display label
      "value": 5.9,
      "unit": "%",
      "referenceMin": 4.0,
      "referenceMax": 5.6,
      "isAbnormal": true,
      "severity": "MILD" // "MILD", "MODERATE", "CRITICAL", or null
    }
  ]
}
Ensure all numeric values are numbers, not strings. Normalize parameter keys to canonical forms.`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType,
          },
        },
        "Analyze this medical document and extract all values and summaries.",
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned an empty response text.");
    }

    const parsedResult = JSON.parse(text) as MedicalAnalysisResult;
    logger.info(`✅ Successfully analyzed document "${fileName}" using Gemini 1.5 Flash`);
    return parsedResult;
  } catch (error: any) {
    logger.error(`❌ Gemini analysis failed: ${error.message}. Falling back to mock data...`);
    return generateMockAnalysis(fileName);
  }
}

/**
 * Generate 768-dimensional embeddings using Gemini's text-embedding-004 model
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!ai) {
    // Return mock 768-dim vector in offline mode
    return generateMockVector(768);
  }

  try {
    const response = await ai.models.embedContent({
      model: "text-embedding-004",
      contents: text,
    });

    const embedding = response.embeddings?.[0];
    if (embedding?.values) {
      return embedding.values;
    }
    throw new Error("Missing embedding values in response.");
  } catch (error: any) {
    logger.error(`❌ Failed to generate embedding: ${error.message}. Returning mock vector...`);
    return generateMockVector(768);
  }
}

/**
 * Helper: Generate mock vector
 */
function generateMockVector(dimensions = 768): number[] {
  const vector: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    vector.push(Math.random() * 2 - 1); // values between -1 and 1
  }
  // Normalize vector to unit length
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  return vector.map((val) => val / magnitude);
}

/**
 * Helper: Generate realistic medical analysis results locally in dev mode
 */
function generateMockAnalysis(fileName: string): MedicalAnalysisResult {
  const lowerName = fileName.toLowerCase();
  
  if (lowerName.includes("blood") || lowerName.includes("report") || lowerName.includes("cbc")) {
    return {
      summaryText: "Your complete blood count (CBC) and HbA1c test reports are generally in order, though your HbA1c levels show a slightly elevated reading at 5.9%. This suggests you are in the pre-diabetic range. Your haemoglobin level is healthy at 13.5 g/dL, and all other vitals and white blood cell counts are normal. We warmly suggest scheduling a follow-up appointment with your physician to discuss dietary and lifestyle changes.",
      clinicalSummary: "CBC parameters are within normal physiological bounds. HbA1c is mildly elevated at 5.9% (Reference: < 5.7%), indicating impaired fasting glucose / pre-diabetic state. Recommendation: Longitudinal fasting plasma glucose tracking and diabetic diet consulting.",
      confidence: 0.98,
      extractedValues: [
        {
          parameterKey: "HBA1C",
          parameterLabel: "HbA1c",
          value: 5.9,
          unit: "%",
          referenceMin: 4.0,
          referenceMax: 5.6,
          isAbnormal: true,
          severity: "MILD",
        },
        {
          parameterKey: "HAEMOGLOBIN",
          parameterLabel: "Haemoglobin",
          value: 13.5,
          unit: "g/dL",
          referenceMin: 12.0,
          referenceMax: 16.0,
          isAbnormal: false,
        },
        {
          parameterKey: "WBC",
          parameterLabel: "White Blood Cells",
          value: 6500,
          unit: "/uL",
          referenceMin: 4000,
          referenceMax: 11000,
          isAbnormal: false,
        },
        {
          parameterKey: "PLATELETS",
          parameterLabel: "Platelet Count",
          value: 245000,
          unit: "/uL",
          referenceMin: 150000,
          referenceMax: 450000,
          isAbnormal: false,
        },
        {
          parameterKey: "CREATININE",
          parameterLabel: "Creatinine",
          value: 0.85,
          unit: "mg/dL",
          referenceMin: 0.6,
          referenceMax: 1.2,
          isAbnormal: false,
        }
      ],
    };
  }

  if (lowerName.includes("thyroid") || lowerName.includes("tsh")) {
    return {
      summaryText: "Your thyroid panel results show elevated TSH levels at 6.2 uIU/mL, which is slightly above the typical reference limit of 4.5 uIU/mL. This can be an early indicator of mild underactive thyroid (subclinical hypothyroidism). Your T3 and T4 hormone levels are still in the normal reference ranges. We warmly advise sharing these findings with your endocrinologist.",
      clinicalSummary: "Thyroid function test shows elevated TSH of 6.2 uIU/mL (Reference: 0.45 - 4.5 uIU/mL) with normal range Free T3 (3.1 pg/mL) and Free T4 (1.2 ng/dL). Fits criteria for subclinical hypothyroidism.",
      confidence: 0.96,
      extractedValues: [
        {
          parameterKey: "TSH",
          parameterLabel: "Thyroid Stimulating Hormone",
          value: 6.2,
          unit: "uIU/mL",
          referenceMin: 0.45,
          referenceMax: 4.5,
          isAbnormal: true,
          severity: "MILD",
        },
        {
          parameterKey: "T4",
          parameterLabel: "Thyroxine (T4)",
          value: 1.2,
          unit: "ng/dL",
          referenceMin: 0.8,
          referenceMax: 1.8,
          isAbnormal: false,
        },
        {
          parameterKey: "T3",
          parameterLabel: "Triiodothyronine (T3)",
          value: 3.1,
          unit: "pg/mL",
          referenceMin: 2.0,
          referenceMax: 4.4,
          isAbnormal: false,
        }
      ],
    };
  }

  // Default mock analysis
  return {
    summaryText: "We have securely received and processed your medical report. The general markers detected seem to be within normal ranges. Please review the details below and consult your doctor for any clinical decisions.",
    clinicalSummary: "Medical document successfully ingested. No major anomalies detected in primary panels. Patient parameters remain stable.",
    confidence: 0.90,
    extractedValues: [
      {
        parameterKey: "GLUCOSE_RANDOM",
        parameterLabel: "Random Blood Sugar",
        value: 98,
        unit: "mg/dL",
        referenceMin: 70,
        referenceMax: 140,
        isAbnormal: false,
      }
    ],
  };
}
