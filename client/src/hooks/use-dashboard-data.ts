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
}

export interface DashboardAssignment {
  id: number;
  workerId: number;
  projectId: number;
  task: string | null;
  shift: string | null;
  startDate: string | null;
  endDate: string | null;
  duration: number | null;
  status: string | null;
  projectCode: string;
  projectName: string;
  customer: string;
  location: string;
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
