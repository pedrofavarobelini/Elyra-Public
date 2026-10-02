"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";


export function PasswordInput({
  className,
  id,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & { id: string }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cn("pr-12", className)}
        {...props}
      />
      <button
        type="button"
        aria-controls={id}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        onClick={() => setVisible((current) => !current)}
        className="motion-press absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-r-control text-ink-subtle transition-colors hover:text-ink focus-visible:outline-offset-[-2px]"
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
