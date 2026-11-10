"use client";
import Image from "next/image";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";


// #region Sample data
const data = [
  {
    name: "Jan",
    income: 4000,
    expense: 2400,
    
  },
  {
    name: "Feb",
    income: 3000,
    expense: 1398,
    
  },
  {
    name: "Mar",
    income: 2000,
    expense: 9800,
    
  },
  {
    name: "Apr",
    income: 2780,
    expense: 3908,
    
  },
  {
    name: "May",
    income: 1890,
    expense: 4800,
    
  },
  {
    name: "Jun",
    income: 2390,
    expense: 3800,
    
  },
  {
    name: "Jul",
    income: 3490,
    expense: 4300,
    
  },
  {
    name: "Aug",
    income: 2000,
    expense: 9800,
    
  },
  {
    name: "Sep",
    income: 2780,
    expense: 3908,
    
  },
  {
    name: "Oct",
    income: 2780,
    expense: 3908,
    
  },
  {
    name: "Nov",
    income: 1890,
    expense: 4800,
    
  },
  {
    name: "Dec",
    income: 2390,
    expense: 3800,
    
  },
];
// #endregion

export default function FinanceChart() {
  return (
    <div className="bg-white rounded-xl w-full h-full p-4 ba">
      {/* TITLE  */}
      <div className=" flex justify-between items-center">
        <h1 className="text-lg font-semibold">Finance</h1>
        <Image src="/moreDark.png" alt="more" width={20} height={20} />
      </div>
      <div>
        <LineChart
          style={{
            width: "100%",
           
            height: "90%",
            
            aspectRatio: 2,
          }}
   
          data={data}
          margin={{
            top: 5,
            right: 0,
            left: 0,
            bottom: 5,
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#ddd" />
          <XAxis
            dataKey="name"
            stroke="var(--color-text-3)"
            axisLine={false}
            tick={{ fill: "#d1d5db" }}
            tickLine={false}
            tickMargin={10}
          />
          <YAxis
            width="auto"
            stroke="var(--color-text-3)"
            axisLine={false}
            tick={{ fill: "#d1d5db" }}
            tickLine={false}
            tickMargin={10}
          />
          <Tooltip
            contentStyle={{ borderRadius: "10px", borderColor: "lightgray" }}
          />
          <Legend
            align="center"
            verticalAlign="top"
            wrapperStyle={{ paddingTop: "20px", paddingBottom: "40px" }}
          />
          <Line
            type="monotone"
            dataKey="income"
            stroke="#C3EBFA"
            strokeWidth={5}
            activeDot={{ r: 8, stroke: "var(--color-surface-base)" }}
          />
          <Line
            type="monotone"
            dataKey="expense"
            stroke="#CFCEFF"
            strokeWidth={5}
            activeDot={{ stroke: "var(--color-surface-base)" }}
          />
        </LineChart>
      </div>
    </div>
  );
}