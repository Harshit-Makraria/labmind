import { PhotoCapture } from "@/components/student/PhotoCapture";

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <PhotoCapture sessionId={sessionId} />;
}
