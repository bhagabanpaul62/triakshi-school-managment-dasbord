import Pagination from "@/components/pagination";
import Table from "@/components/table";
import TableSearch from "@/components/tableSearch";
import {
  classesData,
  examsData,
  lessonsData,
  parentsData,
  resultsData,
  role,
  studentsData,
  subjectsData,
  teachersData,
} from "@/lib/data";
import Image from "next/image";
import Link from "next/link";

import React from "react";

type Result = {
  id: number;
  subject: string;
  class: string;
  teacher: string;
  student: string;
  date: string;
  type: string;
  score: number;
};

const columns = [
  {
    header: "Subject Name",
    className: "hidden md:table-cell",
  },
  {
    header: "Student Name",
    accessor: "studentName",
    className: "md:table-cell",
  },
  {
    header: "Score",
    accessor: "score",
    className: "md:table-cell",
  },

  {
    header: "Teacher",
    accessor: "teacher",
    className: "hidden md:table-cell",
  },
  {
    header: "Class",
    accessor: "className",
    className: "hidden md:table-cell",
  },
  {
    header: "Date",
    accessor: "date",
    className: "hidden md:table-cell",
  },
  {
    header: "Actions",
    accessor: "action",
  },
];

function Results() {
  const renderRow = (item: Result) => (
    <tr
      key={item.id}
      className="border-b border-gray-200 even:bg-slate-50 text-sm hover:bg-lamaPurpleLight"
    >
      <td className="flex items-center gap-4 p-4 hidden  md:table-cell">
        {item.subject}
      </td>
      <td className="  md:table-cell">{item.student}</td>
      <td className="  md:table-cell">{item.score}</td>
      <td className="hidden  md:table-cell">{item.teacher}</td>
      <td className="hidden  md:table-cell">{item.class}</td>
      <td className="hidden  md:table-cell">{item.date}</td>

      <td>
        <div className="flex items-center gap-2">
          <Link href={`/list/teachers/${item.id}`}>
            <button className="w-7 h-7 flex items-center justify-center rounded-full bg-lamaSky">
              <Image src="/edit.png" alt="" width={16} height={16} />
            </button>
          </Link>
          {role === "admin" && (
            <button className="w-7 h-7 flex items-center justify-center rounded-full bg-lamaPurple">
              <Image src="/delete.png" alt="" width={16} height={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  return (
    <div className="bg-white p-4 rounded-md flex-1 m-4">
      {/* TOP  */}
      <div className="flex items-center justify-between">
        <h1 className="hidden md:block text-lg font-semibold ">All Results</h1>
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
          <TableSearch />
          <div className=" flex items-center gap-4 self-end">
            <button className="w-8 h-8 flex items-center justify-center gap-4 rounded-full bg-lamaYellow ">
              <Image
                src={"/filter.png"}
                alt="filter icon"
                width={14}
                height={14}
              ></Image>
            </button>
            <button className="w-8 h-8 flex items-center justify-center gap-4 rounded-full bg-lamaYellow ">
              <Image
                src={"/sort.png"}
                alt="filter icon"
                width={14}
                height={14}
              ></Image>
            </button>
            <button className="w-8 h-8 flex items-center justify-center gap-4 rounded-full bg-lamaYellow ">
              <Image
                src={"/plus.png"}
                alt="filter icon"
                width={14}
                height={14}
              ></Image>
            </button>
          </div>
        </div>
      </div>
      {/* LIST  */}
      <div className="div">
        <Table columns={columns} renderRow={renderRow} data={resultsData} />
      </div>
      {/* PAGINATION */}
      <div className="div">
        <Pagination />
      </div>
    </div>
  );
}

export default Results;
