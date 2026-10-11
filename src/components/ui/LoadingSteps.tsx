"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const loadingSteps = [
  "Validating request headers & token limit...",
  "Allocating upstream synthesis worker...",
  "Generating neural latents & arranging elements...",
  "Applying final polish & encoding media...",
];

export function LoadingSteps({ className }: { className?: string }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % loadingSteps.length);
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center space-y-4 p-8 bg-white border border-slate-200 rounded-2xl w-full max-w-md mx-auto shadow-xs",
        className
      )}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
      >
        <Loader2 className="h-8 w-8 text-blue-600" />
      </motion.div>

      <div className="h-6 overflow-hidden relative w-full text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="text-xs font-medium text-slate-600 absolute w-full"
          >
            {loadingSteps[currentStep]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex space-x-1.5">
        {loadingSteps.map((_, idx) => (
          <div
            key={idx}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              idx === currentStep ? "w-5 bg-blue-600" : "w-1.5 bg-slate-200"
            )}
          />
        ))}
      </div>
    </div>
  );
}
