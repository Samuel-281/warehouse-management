import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#182230",
        line: "#d8dee8",
        work: "#1f6f63",
        amber: "#b7791f",
        danger: "#b42318"
      },
      boxShadow: {
        panel: "0 10px 30px rgba(21, 32, 43, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
