import type { Teacher } from "./domain.js";
import { createService } from "./service.js";
import type { Store } from "./store.js";
import { localDate } from "./time.js";

// Fixed example data (the assignment says we do not need to manage users).
// - child-1 (Sam) has two parents: parent-1 and parent-2.
// - parent-1 (Anna) has children in two classes: teacher-1 and teacher-2.
export function seed(store: Store, now: () => Date): void {
  const teacher: Teacher = { id: "teacher-1", name: "Ms. Jansen", role: "teacher" };
  store.teachers.set(teacher.id, teacher);
  store.teachers.set("teacher-2", { id: "teacher-2", name: "Mr. de Vries", role: "teacher" });

  store.children.set("child-1", { id: "child-1", name: "Sam", teacherId: "teacher-1" });
  store.children.set("child-2", { id: "child-2", name: "Lily", teacherId: "teacher-2" });
  store.children.set("child-3", { id: "child-3", name: "Noor", teacherId: "teacher-1" });
  store.children.set("child-4", { id: "child-4", name: "Milan", teacherId: "teacher-2" });

  const parents: [string, string, string[]][] = [
    ["parent-1", "Anna", ["child-1", "child-2"]],
    ["parent-2", "Ben", ["child-1"]],
    ["parent-3", "Carla", ["child-3"]],
    ["parent-4", "Daan", ["child-4"]],
  ];
  for (const [id, name, childIds] of parents) {
    store.parents.set(id, { id, name, role: "parent", childIds });
  }

  // A sample evening 14 days from now, created through the service so it
  // follows the same rules as any other evening: evening-1 with slot-1..slot-8.
  const day = new Date(now());
  day.setDate(day.getDate() + 14);
  createService(store, now).createEvening(teacher, {
    date: localDate(day),
    startTime: "18:00",
    endTime: "20:00",
    slotMinutes: 15,
  });
}
