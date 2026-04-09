import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface DashboardWorker {
  id: number;
  name: string;
  role: string;
  status: string;
  nationality: string | null;
  age: string | null;
  joined: string | null;
  ctc: string | null;
  englishLevel: string | null;
  techLevel: string | null;
  measuringSkills: string | null;
  countryCode: string | null;
  comments: string | null;
  experienceScore: number | null;
  technicalScore: number | null;
  attitudeScore: number | null;
  oemFocus: string | null;
  oemExperience: string[];
  assignments: DashboardAssignment[];
  dateOfBirth: string | null;
  costCentre: string | null;
  roles: string | null; // JSON array string
  profilePhotoPath: string | null;
  passportPath: string | null;
  driversLicense: string | null;
  driversLicenseUploaded: number | null;
  // Contact information
  personalEmail: string | null;
  workEmail: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  address: string | null;
  // Field kit / logistics
  coverallSize: string | null;
  bootSize: string | null;
  localAirport: string | null;
}

export interface DashboardAssignment {
  id: number;
  workerId: number;
  projectId: number;
  roleSlotId: number | null;
  task: string | null;
  role: string | null;
  shift: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: number | null;
  status: string | null;
  projectCode: string;
  projectName: string;
  customer: string;
  location: string;
  equipmentType?: string | null;
}

export interface DashboardProject {
  id: number;
  code: string;
  name: string;
  customer: string | null;
  location: string | null;
  equipmentType: string | null;
  startDate: string | null;
  endDate: string | null;
  shift: string | null;
  headcount: number | null;
  notes: string | null;
  status: string | null;
  contractType: string | null;
  siteName: string | null;
  siteAddress: string | null;
  sourcingContact: string | null;
  customerProjectManager: string | null;
  siteManager: string | null;
  dayShiftSignatoryName: string | null;
  dayShiftSignatoryEmail: string | null;
  nightShiftSignatoryName: string | null;
  nightShiftSignatoryEmail: string | null;
}

export interface DashboardRoleSlot {
  id: number;
  projectId: number;
  role: string;
  startDate: string;
  endDate: string;
  quantity: number;
  shift: string;
  projectCode: string;
  projectName: string;
}

export interface DashboardData {
  workers: DashboardWorker[];
  projects: DashboardProject[];
  assignments: any[];
  roleSlots: DashboardRoleSlot[];
  oemTypes: any[];
  projectLeads?: Record<number, number>;
}

export function useDashboardData() {
  return useQuery<DashboardData>({
    queryKey: ["/api/dashboard"],
  });
}

export function useWorkers() {
  const { data, ...rest } = useDashboardData();
  return { workers: data?.workers || [], ...rest };
}

export function useProjects() {
  const { data, ...rest } = useDashboardData();
  return { projects: data?.projects || [], ...rest };
}
