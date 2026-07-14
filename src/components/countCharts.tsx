"use client";
import { RadialBarChart, RadialBar, Legend, Tooltip } from "recharts";
import Image from "next/image";

// #region Sample data
const data = [
  {
    name: "Total",
    count: 100,

    fill: "white",
  },
  {
    name: "Boys",
    count: 55,

    fill: "#FAE27C",
  },
  {
    name: "Girls",
    count: 45,

    fill: "#C3EBFA",
  },
];

// #endregion
const style = {
  top: "50%",
  right: 0,
  transform: "translate(0, -50%)",
  lineHeight: "24px",
};

const CountChart = () => {
  return (
    <div className="bg-white rounded-xl w-full h-full p-4 ba">
      {/* TITLE  */}
      <div className=" flex justify-between items-center">
        <h1 className="text-lg font-semibold">Students</h1>
        <Image src="/moreDark.png" alt="more" width={20} height={20} />
      </div>
      {/* CHARTS  */}
      <div className="relative w-full h-[75%]">
        <RadialBarChart
          style={{
            width: "100%",
            maxWidth: "700px",
            maxHeight: "80vh",
            aspectRatio: 1,
          }}
          responsive
          cx="50%"
          cy="50%"
          innerRadius="40%"
          outerRadius="100%"
          barSize={32}
          data={data}
        >
          <RadialBar background dataKey="count" />
        </RadialBarChart>
        <Image
          src="/maleFemale.png"
          alt="maleFemale"
          width={50}
          height={50}
          className="absolute top-1/2 left-1/2  -translate-x-1/2 -translate-y-1/2 "
        />
      </div>
      {/* BOTTOM  */}
      <div className="flex justify-center gap-16">
        <div className=" flex flex-col gap-1">
          <div className="w-5 h-5 bg-lamaSky rounded-full" />
          <h1 className="font-bold">1,232</h1>
          <h2 className="text-xs text-gray-300 ">Boys (55%)</h2>
        </div>
        <div className=" flex flex-col gap-1">
          <div className="w-5 h-5 bg-lamaYellow rounded-full" />
          <h1 className="font-bold">1,232</h1>
          <h2 className="text-xs text-gray-300 ">Girls (45%)</h2>
        </div>
      </div>
    </div>
  );
};

export default CountChart;
