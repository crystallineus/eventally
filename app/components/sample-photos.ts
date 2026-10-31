// Browser-only: the range hood repair's sample photos, for trying a claim without your own files.

export const SAMPLE_CLAIM = {
  title: "Range hood light not working",
  description: "The light on the kitchen range hood stopped turning on. A technician replaced the socket and bulbs.",
  issueDate: "2026-10-21",
  amount: "184.43",
  photos: [
    { kind: "receipt", name: "hood-light-replacement/light-receipt.jpg" },
    { kind: "before", name: "hood-light-replacement/light-before.jpeg" },
    { kind: "after", name: "hood-light-replacement/light-after.jpeg" },
  ],
} as const;

export type SampleKind = (typeof SAMPLE_CLAIM.photos)[number]["kind"];

/** Download the sample photos as File objects, ready for a form or the chat. */
export async function loadSamplePhotos(): Promise<{ kind: SampleKind; file: File }[]> {
  return Promise.all(
    SAMPLE_CLAIM.photos.map(async ({ kind, name }) => {
      const res = await fetch(`/api/demo/sample?name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error("Couldn't load the sample photos");
      return { kind, file: new File([await res.blob()], name.split("/").pop()!, { type: "image/jpeg" }) };
    }),
  );
}
