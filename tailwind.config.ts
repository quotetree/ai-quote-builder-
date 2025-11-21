import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          green: "#2d5a47",
          "green-dark": "#1f4e3c",
          "green-light": "#3a6b56",
        },
        green: {
          50: "#f0f7f4",
          100: "#d9ede5",
          200: "#b3dccb",
          300: "#8dcab1",
          400: "#67b897",
          500: "#3a6b56",
          600: "#2d5a47",
          700: "#1f4e3c",
          800: "#1a3f32",
          900: "#152f27",
        },
      },
    },
  },
  plugins: [],
};
export default config;

