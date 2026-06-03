"use client";

import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ExplainBlockProps {
  title: string;
  children: React.ReactNode;
}

/** Plain-language "why this exists & why you should care" note, shown above every
 *  complex section. Built from the shadcn/21st.dev Alert primitive. */
export default function ExplainBlock({ title, children }: ExplainBlockProps) {
  return (
    <Alert className="mb-3">
      <Info className="h-4 w-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
