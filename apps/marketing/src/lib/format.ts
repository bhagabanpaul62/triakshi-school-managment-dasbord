/** ₹ in the Indian grouping, no decimals: 7500000 paise -> "₹75,000". */
export const rupees = (paise: number) => `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(paise / 100)}`;
