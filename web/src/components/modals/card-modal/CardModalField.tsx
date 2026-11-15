import { forwardRef, useState, useRef, useEffect } from "react";
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";

export type CardModalTextFieldHintState = "info" | "warning" | "error";

const HINT_STYLE: Record<CardModalTextFieldHintState, { icon: string; color: string }> = {
    info: { icon: "info", color: "text-faint hover:text-accent" },
    warning: { icon: "warning", color: "text-warn hover:text-warn" },
    error: { icon: "error", color: "text-danger hover:text-danger" },
};

interface CardModalFieldBase {
    id: string;
    label: string;
    unit?: string;
    disabled?: boolean;
    hint?: string;
    hintState?: CardModalTextFieldHintState;
}

interface CardModalInputConfig extends CardModalFieldBase {
    type?: "text" | "password" | "number" | "Integer" | "Decimal" | "String";
    value: string;
    placeholder?: string;
    required?: boolean;
    min?: number;
    max?: number;
    onChange?: (value: string) => void;
    onConfirm?: () => void;
}

interface CardModalSelectConfig extends CardModalFieldBase {
    type: "select";
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange?: (value: string) => void;
}

interface CardModalCheckboxConfig extends CardModalFieldBase {
    type: "checkbox";
    checked: boolean;
    onChange?: (checked: boolean) => void;
}

export type CardModalFieldConfig =
    | CardModalInputConfig
    | CardModalSelectConfig
    | CardModalCheckboxConfig;

function isInputVariant(config: CardModalFieldConfig): config is CardModalInputConfig {
    return config.type !== "select" && config.type !== "checkbox";
}

const CardModalField = forwardRef<HTMLInputElement, CardModalFieldConfig>((props, ref) => {
    const { label, disabled = false, hint, hintState = "info" } = props;
    const isNumericType = props.type === "number" || props.type === "Integer" || props.type === "Decimal";
    const effectiveUnit = props.unit && isNumericType ? props.unit : undefined;
    const displayLabel = effectiveUnit ? `${label} (${effectiveUnit})` : label;
    const hs = HINT_STYLE[hintState];
    const showRequiredMarker =
        isInputVariant(props) && props.required === true && props.value.trim().length === 0;

    const [isFocused, setIsFocused] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [copied, setCopied] = useState(false);
    const copyResetTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
        return () => {
            if (copyResetTimeoutRef.current !== null) {
                window.clearTimeout(copyResetTimeoutRef.current);
            }
        };
    }, []);

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        const valueToCopy = isInputVariant(props) ? (props.placeholder ?? "") : "";
        if (!valueToCopy) return;
        await navigator.clipboard.writeText(valueToCopy);
        setCopied(true);
        if (copyResetTimeoutRef.current !== null) {
            window.clearTimeout(copyResetTimeoutRef.current);
        }
        copyResetTimeoutRef.current = window.setTimeout(() => {
            setCopied(false);
            copyResetTimeoutRef.current = null;
        }, 3000);
    };

    return (
        <div className="flex items-start gap-3 min-w-0">
            {/* Label */}
            <div className="w-1/3 shrink-0 h-8 flex items-center gap-1 min-w-0">
                <label
                    className="text-sm text-muted tracking-wide truncate min-w-0 cursor-default"
                    title={displayLabel}
                >
                    {displayLabel}
                </label>
                {showRequiredMarker && (
                    <span className="text-danger text-sm leading-none shrink-0 cursor-default" title="Required field" aria-hidden="true">
                        *
                    </span>
                )}
                <span className="flex-1 min-w-0 h-1 bg-[radial-gradient(circle,#d1d5db_1.5px,transparent_1.5px)] bg-size-[10px_10px] bg-repeat-x bg-center" />
                {hint && (
                    <span
                        className={`shrink-0 flex items-center cursor-default transition-colors ${hs.color}`}
                        title={hint}
                    >
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{hs.icon}</span>
                    </span>
                )}
            </div>

            {/* Control */}
            {props.type === "select" ? (
                <div className="flex-1 min-w-0 flex items-center h-8">
                    <Listbox value={props.value} onChange={(v) => props.onChange?.(v)} disabled={disabled}>
                        <ListboxButton className="group w-full flex items-center gap-1 border border-line-strong rounded bg-surface text-left select-none focus:outline-none px-2 h-7 cursor-pointer data-open:border-accent data-disabled:cursor-default data-disabled:bg-raised data-disabled:text-muted transition-colors">
                            <span className="text-sm flex-1 truncate text-fg group-data-disabled:text-muted">
                                {props.options.find((o) => o.value === props.value)?.label ?? "\u00A0"}
                            </span>
                            <span
                                className="material-symbols-outlined shrink-0 transition-transform duration-150 text-faint group-data-open:rotate-180 group-data-open:text-accent group-data-disabled:text-faint"
                                style={{ fontSize: 16 }}
                            >
                                expand_more
                            </span>
                        </ListboxButton>
                        <ListboxOptions
                            anchor={{ to: "bottom start", gap: 4 }}
                            className="w-(--button-width) border border-line-strong rounded shadow-md bg-surface max-h-48 overflow-y-auto outline-none z-200 select-none cursor-default"
                        >
                            {props.options.map((opt) => (
                                <ListboxOption
                                    key={opt.value}
                                    value={opt.value}
                                    className="px-3 py-1 text-sm cursor-pointer transition-colors text-fg border-b border-surface last:border-b-0 data-focus:bg-accent data-focus:text-on-accent data-selected:bg-accent data-selected:text-on-accent data-selected:font-medium"
                                >
                                    {opt.label || "\u00A0"}
                                </ListboxOption>
                            ))}
                        </ListboxOptions>
                    </Listbox>
                </div>
            ) : props.type === "checkbox" ? (
                <div className="flex-1 min-w-0 h-8 flex items-center">
                    <button
                        type="button"
                        role="switch"
                        aria-checked={props.checked}
                        disabled={disabled}
                        onClick={() => !disabled && props.onChange?.(!props.checked)}
                        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors focus:outline-none ${disabled ? "opacity-50 cursor-default" : "cursor-pointer"
                            } ${props.checked ? "bg-accent" : "bg-pressed"}`}
                    >
                        <span
                            className={`inline-block h-3 w-3 rounded-full bg-surface shadow transition-transform ${props.checked ? "translate-x-3.5" : "translate-x-0.5"
                                }`}
                        />
                    </button>
                </div>
            ) : (
                <div
                    className="flex-1 min-w-0 flex items-center h-8"
                    onMouseEnter={() => setIsHovered(true)}
                    onMouseLeave={() => setIsHovered(false)}
                >
                    <div className="relative w-full">
                        {(() => {
                            const showCopyBtn = (isFocused || isHovered) && !disabled && props.type !== "password" && !props.value && !!props.placeholder;
                            return (
                                <>
                                    <input
                                        ref={ref}
                                        type={props.type === "password" ? "password" : "text"}
                                        inputMode={isNumericType ? "numeric" : undefined}
                                        value={props.value}
                                        placeholder={props.placeholder}
                                        required={props.required}
                                        aria-required={props.required}
                                        disabled={disabled}
                                        title={props.type !== "password" ? props.value || props.placeholder : undefined}
                                        onChange={(e) => props.onChange?.(e.target.value)}
                                        onFocus={() => setIsFocused(true)}
                                        onBlur={() => {
                                            setIsFocused(false);
                                            if (isNumericType && props.value !== "") {
                                                const numeric = Number(props.value);
                                                if (!isNaN(numeric)) {
                                                    if (props.min !== undefined && numeric < props.min) {
                                                        props.onChange?.(String(props.min));
                                                    } else if (props.max !== undefined && numeric > props.max) {
                                                        props.onChange?.(String(props.max));
                                                    }
                                                }
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") props.onConfirm?.();
                                        }}
                                        className={`w-full px-2 text-sm border rounded text-fg placeholder:text-faint placeholder:italic h-7 focus:outline-none transition-colors disabled:bg-raised disabled:text-muted disabled:cursor-default truncate ${isNumericType && showCopyBtn ? "pr-10" : isNumericType ? "pr-5" : showCopyBtn ? "pr-6" : ""
                                            } ${isFocused ? "border-accent" : "border-line-strong"}`}
                                    />
                                    {showCopyBtn && (
                                        <button
                                            type="button"
                                            tabIndex={-1}
                                            onClick={handleCopy}
                                            title={copied ? "Copied" : "Copy to clipboard"}
                                            className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center transition-colors cursor-pointer ${copied ? "text-ok" : "text-faint hover:text-muted"}`}
                                        >
                                            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                                                {copied ? "check" : "content_copy"}
                                            </span>
                                        </button>
                                    )}
                                    {isNumericType && (isFocused || isHovered) && !disabled && (
                                        <div className={`absolute ${showCopyBtn ? "right-5" : "right-px"} top-1/2 -translate-y-1/2 flex flex-col w-3 mr-1.5`}>
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    const next = Number(props.value) + 1;
                                                    props.onChange?.(String(props.max !== undefined && next > props.max ? props.max : next));
                                                }}
                                                className="flex items-center justify-center text-faint hover:text-fg active:text-accent cursor-pointer"
                                                style={{ height: 12 }}
                                            >
                                                <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>expand_less</span>
                                            </button>
                                            <button
                                                type="button"
                                                tabIndex={-1}
                                                onMouseDown={(e) => {
                                                    e.preventDefault();
                                                    const next = Number(props.value) - 1;
                                                    props.onChange?.(String(props.min !== undefined && next < props.min ? props.min : next));
                                                }}
                                                className="flex items-center justify-center text-faint hover:text-fg active:text-accent cursor-pointer"
                                                style={{ height: 12 }}
                                            >
                                                <span className="material-symbols-outlined leading-none" style={{ fontSize: 14 }}>expand_more</span>
                                            </button>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
});

CardModalField.displayName = "CardModalField";

export default CardModalField;
