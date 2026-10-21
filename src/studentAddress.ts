const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "上官", "诸葛", "东方", "皇甫", "尉迟", "公孙", "慕容", "司徒", "司空",
  "夏侯", "宇文", "长孙", "令狐", "独孤", "南宫", "端木", "闻人", "钟离", "轩辕", "百里",
]);
const SINGLE_SURNAMES = new Set(Array.from(
  "王李张刘陈杨黄赵吴周徐孙马朱胡郭何林高罗郑梁谢宋唐许邓韩冯曹彭曾肖萧田董袁潘于蒋蔡余杜叶程魏苏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付傅方白邹孟熊秦邱侯江尹薛阎闫段雷龙史陶黎贺顾毛郝龚邵万钱戴严武孔向汤常温康施文牛樊葛邢安齐易乔伍庞颜倪庄聂章鲁岳翟殷詹申欧耿关兰焦俞左柳甘祝包宁尚符舒阮柯纪梅童凌毕单季裴霍涂成苗谷曲盛冉翁蓝骆路游辛靳欧阳管柴蒙鲍华喻祁蒲房滕屈饶解米池艾尤缪乐牟赖洪莫裘杭隋晏茅仇荣甄覃瞿查迟邬闵褚费岑湛",
));

/** Shorten only recognizable Chinese surname + two-character given names.
 * Keep two-character names, compound surname + single names, and uncertain names intact.
 */
export function friendlyStudentName(studentName: string): string {
  const name = studentName.trim();
  if (!/^\p{Script=Han}+$/u.test(name)) return name;
  const characters = Array.from(name);
  const compoundSurname = COMPOUND_SURNAMES.has(characters.slice(0, 2).join(""));
  if (compoundSurname) return characters.length === 4 ? characters.slice(2).join("") : name;
  return characters.length === 3 && SINGLE_SURNAMES.has(characters[0]) ? characters.slice(1).join("") : name;
}
