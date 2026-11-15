import { Dialog, DialogBackdrop, DialogPanel } from "@headlessui/react";
import type { ReactNode } from "react";
import { useShortcutsBlocked } from "@/hooks/shortcut-manager/useShortcutsBlocked";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    /** Names the dialog for screen readers; blocks the global shortcuts while it is open. */
    token: string;
    className?: string;
    children: ReactNode;
}

/** A modal on Headless UI's Dialog: traps focus, closes on Escape and outside click. */
export default function Modal({ open, onClose, token, className = "w-full max-w-md", children }: ModalProps) {
    useShortcutsBlocked(token, open);
    return (
        <Dialog open={open} onClose={onClose} className="relative z-60">
            <DialogBackdrop transition className="fixed inset-0 bg-overlay transition-opacity data-closed:opacity-0" />
            <div className="fixed inset-0 flex items-center justify-center p-4">
                <DialogPanel className={`flex max-h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface text-fg shadow-xl ${className}`}>
                    {children}
                </DialogPanel>
            </div>
        </Dialog>
    );
}
