import { create } from "zustand";
import type { ComputeResult } from "@/data/local/serviceTypes";

interface CppDebugState {
    isDebugMode: boolean;
    isOpen: boolean;
    controlPosition: { x: number; y: number };
    sessionId: string | null;
    totalSteps: number;
    currentStep: number;
    /** Full partial compute result from the latest step snapshot. */
    currentResult: ComputeResult | null;
    /** Algorithm and provider IDs captured at session start — used to filter provider layers in the debug canvas. */
    sessionAlgorithmId: number | null;
    sessionProviderId: number | null;
    startDebug: () => void;
    stopDebug: () => void;
    setControlPosition: (position: { x: number; y: number }) => void;
    setSessionId: (id: string | null) => void;
    setTotalSteps: (n: number) => void;
    setCurrentStep: (n: number) => void;
    setCurrentResult: (result: ComputeResult) => void;
    clearCurrentResult: () => void;
    setSessionContext: (algorithmId: number, providerId: number) => void;
}

export const useCppDebugStore = create<CppDebugState>((set) => ({
    isDebugMode: false,
    isOpen: false,
    controlPosition: { x: 16, y: 16 },
    sessionId: null,
    totalSteps: 0,
    currentStep: 0,
    currentResult: null,
    sessionAlgorithmId: null,
    sessionProviderId: null,
    startDebug: () => set({ isDebugMode: true, isOpen: true }),
    stopDebug: () => set({ isDebugMode: false, isOpen: false, sessionId: null, totalSteps: 0, currentStep: 0, currentResult: null, sessionAlgorithmId: null, sessionProviderId: null }),
    setControlPosition: (position) => set({ controlPosition: position }),
    setSessionId: (id) => set({ sessionId: id }),
    setTotalSteps: (n) => set({ totalSteps: n }),
    setCurrentStep: (n) => set({ currentStep: n }),
    setCurrentResult: (result) => set({ currentResult: result }),
    clearCurrentResult: () => set({ currentResult: null, currentStep: 0 }),
    setSessionContext: (algorithmId, providerId) => set({ sessionAlgorithmId: algorithmId, sessionProviderId: providerId }),
}));


