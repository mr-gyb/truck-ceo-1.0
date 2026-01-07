
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { Product, SmartSuggestion, Truck } from "../types";

// Check if API key exists and is valid
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';
const isApiKeyValid = apiKey && apiKey !== 'PLACEHOLDER_API_KEY' && apiKey.length > 10;

const ai = isApiKeyValid ? new GoogleGenAI({ apiKey }) : null;

// Tool definitions for the AI Agent
export const agentTools: FunctionDeclaration[] = [
  {
    name: 'update_order_quantity',
    description: 'Updates the recommended or actual order quantity for a specific product.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productId: { type: Type.STRING, description: 'The ID of the product to update.' },
        newQuantity: { type: Type.NUMBER, description: 'The new order quantity.' },
        reason: { type: Type.STRING, description: 'Brief reason for the manual override.' }
      },
      required: ['productId', 'newQuantity']
    }
  },
  {
    name: 'update_employee_status',
    description: 'Updates a team member status or logs an event like sick day or vacation.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        employeeId: { type: Type.STRING, description: 'The name or ID of the employee (e.g. Andres, Adrian).' },
        status: { type: Type.STRING, description: 'The new status (active, off, break, vacation, sick).' },
        note: { type: Type.STRING, description: 'Note regarding the change (e.g., "Doctor appointment").' }
      },
      required: ['employeeId', 'status']
    }
  },
  {
    name: 'report_truck_issue',
    description: 'Logs a new maintenance issue or updates the health status of a truck.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        truckId: { type: Type.STRING, description: 'The plate or ID of the truck (e.g. GMC-06-01).' },
        issue: { type: Type.STRING, description: 'Description of the problem.' },
        healthStatus: { type: Type.STRING, description: 'New health status (good, warning, critical).' }
      },
      required: ['truckId', 'healthStatus']
    }
  }
];

export const getSmartOrderSuggestions = async (
  products: Product[],
  currentDate: string,
  weather: string = "Sunny, 75°F"
): Promise<SmartSuggestion[]> => {
  // If no valid API key, return mock suggestions
  if (!ai || !isApiKeyValid) {
    console.warn('⚠️ Gemini API key not configured. Using mock suggestions.');
    return products.slice(0, 3).map((product, index) => ({
      productId: product.id,
      recommendedQty: product.lastOrderQuantity + 20,
      reason: 'Demo mode - Configure VITE_GEMINI_API_KEY for AI suggestions',
      impactLevel: index === 0 ? 'high' : index === 1 ? 'medium' : 'low'
    }));
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are a logistics expert for TruckCEO.com. Analyze the bread route inventory and suggest order quantities based on seasonal trends.
      
      Context:
      - Current Date: ${currentDate}
      - Weather: ${weather}
      - Products: ${JSON.stringify(products)}
      
      Market Rules:
      1. Buns (Hamburger/Hot Dog) demand surges (3x-5x) during summer, fall, and major holidays (July 4th, Labor Day, Memorial Day) due to BBQs.
      2. Snacks (Tastykakes) demand increases (2x) during winter and colder weather.
      3. Sliced bread remains stable but dips slightly in summer.
      
      Task:
      Generate recommended order quantities for each product.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              productId: { type: Type.STRING },
              recommendedQty: { type: Type.NUMBER },
              reason: { type: Type.STRING },
              impactLevel: { type: Type.STRING, enum: ['low', 'medium', 'high'] }
            },
            required: ['productId', 'recommendedQty', 'reason', 'impactLevel']
          }
        }
      }
    });

    if (!response.text) return [];
    return JSON.parse(response.text);
  } catch (error) {
    console.error("Gemini Error:", error);
    return products.map(p => ({
      productId: p.id,
      recommendedQty: Math.floor(p.lastOrderQuantity * 1.1),
      reason: "Historical average (AI unavailable)",
      impactLevel: 'low'
    }));
  }
};

export const runAgentChat = async (message: string, history: any[]) => {
  if (!ai || !isApiKeyValid) {
    console.warn('⚠️ Gemini API key not configured.');
    return "AI Agent is currently unavailable. Please configure VITE_GEMINI_API_KEY in your .env.local file to enable AI features.";
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [
        { role: 'user', parts: [{ text: `You are the TruckCEO AI Agent for "Mateos in Motion". You help Chris, Virgil, and Charlotte Mateo manage their bread distribution empire.
          
          BUSINESS CONTEXT:
          - Executives: Chris Mateo, Virgil Mateo, Charlotte Mateo.
          - Route Drivers: Andres, Adrian, Ronaldo, Alex.
          - Fleet: 5 GMC 2006 (16ft) box trucks, 1 Isuzu 2014 (20ft) box truck.
          - Territories: Yonkers (NY), Ossining (NY), Milford (CT), Stratford (CT), Ridgefield (CT), Norwalk (CT).
          - Partners: Bimbo, Flowers.

          CAPABILITIES:
          - You can update orders, track employees, and manage fleet maintenance using available tools.
          - You analyze weather patterns (e.g. heatwaves surging bun demand).
          - You provide business insights and execute operational updates.
          
          Always be professional, highly capable, and proactive. If a user asks a question about the business, answer based on this context. If they ask to update something, use the provided tools.
          
          User message: ${message}` }] }
      ],
      config: {
        tools: [{ functionDeclarations: agentTools }]
      }
    });

    return {
      text: response.text || "I've processed your request and updated the system.",
      functionCalls: response.functionCalls
    };
  } catch (error) {
    console.error("Agent Error:", error);
    return { text: "I'm having trouble connecting to the Mateo business servers right now. Please try again." };
  }
};

export const getTruckSafeRoute = async (start: string, end: string, truck: Truck) => {
  if (!ai || !isApiKeyValid) {
    console.warn('⚠️ Gemini API key not configured.');
    return {
      route: `${start} → ${end}`,
      distance: "Calculating...",
      duration: "Calculating...",
      warnings: ["AI route calculation unavailable - Configure VITE_GEMINI_API_KEY"]
    };
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `Calculate a truck-safe navigation route from "${start}" to "${end}".
      TRUCK CONSTRAINTS:
      - Height: ${truck.dimensions.height} feet
      - Weight: ${truck.dimensions.weight} lbs
      - Length: ${truck.dimensions.length} feet
      
      CRITICAL: Avoid any parkways where trucks are prohibited (like Merritt Parkway, Hutchinson River Parkway) and any bridges with clearance lower than ${truck.dimensions.height + 0.5} feet.
      Provide step-by-step driving directions that strictly adhere to these constraints.`,
      config: {
        tools: [{ googleMaps: {} }]
      }
    });

    return {
      text: response.text,
      grounding: response.candidates?.[0]?.groundingMetadata?.groundingChunks
    };
  } catch (error) {
    console.error("Routing Error:", error);
    return { text: "Failed to calculate truck-safe route. Please use secondary commercial route maps." };
  }
};
