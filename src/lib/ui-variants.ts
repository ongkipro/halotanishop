import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 text-center font-semibold transition-all active:scale-[0.98] disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        primary: 'bg-[#111111] text-white hover:bg-[#333333]',
        secondary: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
        dark: 'bg-slate-900 text-white shadow-xs hover:bg-slate-800',
        ghost: 'bg-transparent text-slate-700 hover:bg-slate-100',
      },
      size: {
        sm: 'h-10 rounded-xl px-4 text-xs font-bold',
        md: 'h-11 rounded-xl px-5 text-xs font-bold',
        lg: 'h-12 rounded-xl px-6 text-xs font-bold',
        compact: 'rounded-lg px-3.5 py-2 text-xs font-bold',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export const badgeVariants = cva('inline-flex items-center font-bold leading-none', {
  variants: {
    variant: {
      green: 'bg-[#F5F5F5] text-[#111111] ring-1 ring-[#E5E5E5]',
      neutral: 'bg-slate-100 text-slate-700',
      yellow: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200/60',
    },
    size: {
      sm: 'rounded-md px-2 py-1 text-[10px] uppercase tracking-wider',
      md: 'rounded-md px-2.5 py-1 text-[11px]',
      pill: 'rounded-full px-2.5 py-1 text-[11px]',
    },
  },
  defaultVariants: {
    variant: 'green',
    size: 'md',
  },
});

export const listItemVariants = cva('border-b border-slate-100 first:pt-0 last:border-b-0 last:pb-0', {
  variants: {
    density: {
      compact: 'py-3.5',
      normal: 'py-4.5',
      comfortable: 'py-5.5',
      featured: 'pb-5.5',
    },
  },
  defaultVariants: {
    density: 'normal',
  },
});

export const textVariants = cva('', {
  variants: {
    tone: {
      heading: 'text-slate-900',
      brand: 'text-[#111111]',
      accent: 'text-[#111111]',
      muted: 'text-slate-500',
      soft: 'text-slate-600',
      body: 'text-slate-600',
    },
  },
  defaultVariants: {
    tone: 'body',
  },
});

