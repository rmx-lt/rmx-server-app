import type { ReactNode } from "react";

interface Props {
    children: ReactNode;
}

export default function MenuBarSubmenu({ children }: Props) {
    return <div className="w-max py-1 bg-gray-100">{children}</div>;
}
