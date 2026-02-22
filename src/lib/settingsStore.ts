const STORAGE_KEY = "caregiver_settings";

export interface CaregiverSettings {
  patientName: string;
  caregiverEmail: string;
  emailNotifications: boolean;
}

const defaults: CaregiverSettings = {
  patientName: "",
  caregiverEmail: "",
  emailNotifications: false,
};

export function getCaregiverSettings(): CaregiverSettings {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) } as CaregiverSettings;
  } catch {
    return { ...defaults };
  }
}

export function saveCaregiverSettings(settings: CaregiverSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
