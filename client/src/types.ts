export type Role = 'admin' | 'dispatcher' | 'viewer';

export interface User {
  id: number;
  username: string;
  name: string;
  role: Role;
  islandIds: number[];
}

export interface Island {
  id: number;
  name: string;
  code: string;
  color: string;
  sort: number;
  accessible: boolean;
}

export interface Skill {
  id: number;
  name: string;
  category: string;
}

export interface TechSkill {
  skill_id: number;
  level: number; // 1 trainee, 2 qualified, 3 expert
}

export type LocationStatus = 'home' | 'travel' | 'off';

export interface DayLocation {
  islandId: number;
  status: LocationStatus;
  travelId: number | null;
  offId: number | null;
}

export interface Technician {
  id: number;
  name: string;
  phone: string;
  email: string;
  home_island_id: number;
  color: string;
  active: number;
  notes: string;
  skills: TechSkill[];
  today?: DayLocation;
}

export interface BoardTech extends Technician {
  days: Record<string, DayLocation>;
}

export type Priority = 'low' | 'normal' | 'high' | 'emergency';
export type JobStatus = 'unscheduled' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';

export interface Job {
  id: number;
  island_id: number;
  technician_id: number | null;
  title: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  job_type: string;
  priority: Priority;
  status: JobStatus;
  start_at: string | null; // YYYY-MM-DDTHH:MM
  end_at: string | null;
  duration_minutes: number;
  notes: string;
  skill_ids: number[];
  conflict?: string | null;
}

export interface Travel {
  id: number;
  technician_id: number;
  technician_name: string;
  kind: 'travel' | 'time_off';
  island_id: number | null;
  island_name: string | null;
  home_island_id: number;
  home_island_name: string;
  start_date: string;
  end_date: string;
  notes: string;
}

export interface Board {
  island_id: number;
  start: string;
  end: string;
  days: string[];
  technicians: BoardTech[];
  jobs: Job[];
  unscheduled: Job[];
  travel: Travel[];
}

export type ViewMode = 'day' | 'week' | 'month';

export const PRIORITIES: Priority[] = ['emergency', 'high', 'normal', 'low'];
export const STATUSES: JobStatus[] = ['unscheduled', 'scheduled', 'in_progress', 'completed', 'cancelled'];
export const STATUS_LABEL: Record<JobStatus, string> = {
  unscheduled: 'Unscheduled',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
export const LEVEL_LABEL = ['', 'Trainee', 'Qualified', 'Expert'];
export const JOB_TYPES = ['Service', 'Maintenance', 'Repair', 'Install', 'Estimate', 'Warranty', 'Inspection'];
