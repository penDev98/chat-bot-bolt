/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2A3075', // Brand dark blue
          dark: '#1D2152',
          light: '#397DFF',
        },
        secondary: {
          DEFAULT: '#5B9FD7', // Brand light blue
          light: '#E0F2FE', // Very light blue for backgrounds
        },
        accent: {
          DEFAULT: '#0EA5E9',
        }
      },
      fontFamily: {
        sans: ['Inter', 'Roboto', 'sans-serif'], // Modern sans-serif
      },
      boxShadow: {
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'floating': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      }
    },
  },
  plugins: [],
};
