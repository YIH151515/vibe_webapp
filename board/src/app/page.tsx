import { Suspense } from "react";
import { BoardList } from "@/components/board-list";
import { Loading } from "@/components/feedback";

export default function Home(): React.JSX.Element {
  return <Suspense fallback={<Loading />}><BoardList /></Suspense>;
}
