import { ResultEntry } from "@/components/student/ResultEntry";

export default async function ResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <ResultEntry sessionId={sessionId} />;
}
