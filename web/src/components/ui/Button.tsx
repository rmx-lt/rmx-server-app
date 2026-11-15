import type { ButtonHTMLAttributes } from "react";

type Variant = "default" | "primary" | "danger";

const STYLES: Record<Variant, string> = {
    default: "border border-line-strong text-fg hover:bg-hover",
    primary: "border border-accent bg-accent text-on-accent hover:bg-accent-hover hover:border-accent-hover",
    danger: "border border-danger bg-danger text-on-accent hover:opacity-90",
};

export default function Button({
    variant = "default",
    className = "",
    ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
    return (
        <button
            type="button"
            {...rest}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${STYLES[variant]} ${className}`}
        />
    );
}
