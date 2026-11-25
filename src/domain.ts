export interface Teacher {
  id: string;
  name: string;
  role: "teacher";
}

export interface Parent {
  id: string;
  name: string;
  role: "parent";
  childIds: string[];
}

export type User = Teacher | Parent;

export interface Child {
  id: string;
  name: string;
  teacherId: string;
}

// date is "YYYY-MM-DD"; startTime/endTime are "HH:mm" (school-local wall-clock time).
export interface Evening {
  id: string;
  teacherId: string;
  date: string;
  startTime: string;
  endTime: string;
  slotMinutes: number;
}

export interface Slot {
  id: string;
  eveningId: string;
  startTime: string;
  endTime: string;
  maxBookings: number;
}

export interface Booking {
  id: string;
  slotId: string;
  childId: string;
  bookedByParentId: string;
}
