import { Vehicle } from "../types";
import { authFetch } from "../utils/apiClient";

export const generateVehicleAnalysis = async (vehicle: Vehicle): Promise<string> => {
  try {
    const response = await authFetch('/api/generate-vehicle-assessment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vehicle })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to analyze');
    return data.text || "Analysis currently unavailable.";
  } catch (error) {
    console.error("Error generating vehicle analysis:", error);
    return "AI Analysis service is temporarily unavailable. Please verify the vehicle details manually.";
  }
};

export const validateCarImage = async (base64Data: string, mimeType: string): Promise<boolean> => {
  try {
    const response = await authFetch('/api/validate-car-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data, mimeType })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to validate');
    return data.isVehicle;
  } catch (error) {
    console.error("Error validating car image:", error);
    return true;
  }
};

export interface VehicleImageAnalysis {
  isVehicle: boolean;
  make?: string;
  model?: string;
  year?: string;
  color?: string;
  bodyType?: string;
  engine?: string;
  topSpeed?: string;
  mpg?: string;
  fuelType?: string;
}

export const analyzeVehicleImage = async (base64Data: string, mimeType: string): Promise<VehicleImageAnalysis> => {
  try {
    const response = await authFetch('/api/analyze-car-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data, mimeType })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to analyze');
    return data;
  } catch (error) {
    console.error("Error analyzing car image:", error);
    return { isVehicle: true };
  }
};