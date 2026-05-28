import { type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm font-medium leading-none select-none text-content-secondary",
        className
      )}
      {...props}
    />
  );
}
