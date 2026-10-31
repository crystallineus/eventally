import { TourBubble, type BubbleAction } from "@/app/components/tour-bubble";
import { getCurrentUser } from "@/lib/session";
import { getTour } from "@/lib/tour";

// Aunt Tally walks first-time visitors through the trial steps from a bubble above her chat
// button, on every page. Which step is next comes from lib/tour.ts.
export async function TourGuide() {
  const user = await getCurrentUser();
  const tour = user && (await getTour(user));
  if (!tour) return null;
  const step = tour.next;
  const index = step ? tour.steps.indexOf(step) + 1 : tour.steps.length;
  const action: BubbleAction | null = !step
    ? null
    : step.role !== tour.role
      ? { kind: "switch", userId: tour.people[step.role].id, name: tour.people[step.role].firstName, next: step.href }
      : step.key === "aunt_claim"
        ? { kind: "aunt" }
        : { kind: "go", href: step.href };
  return (
    <TourBubble
      step={step ? { index, title: step.title, hint: step.hint } : null}
      total={tour.steps.length}
      done={tour.steps.filter((s) => s.done).length}
      action={action}
    />
  );
}
