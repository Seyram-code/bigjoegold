import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        primary: "border border-[#b88d24] bg-[#292313] text-[#ffd344] hover:bg-[#292313]",
        gold: "border border-[#b88d24] bg-[#292313] text-[#ffd344] hover:bg-[#292313]",
        outline: "border border-[#b88d24] bg-[#292313] text-[#ffd344] hover:bg-[#292313]",
        ghost: "border border-[#b88d24] bg-[#292313] text-[#ffd344] hover:bg-[#292313]",
        danger: "border border-[#b88d24] bg-[#292313] text-[#ffd344] hover:bg-[#292313]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return <Component data-action-button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
