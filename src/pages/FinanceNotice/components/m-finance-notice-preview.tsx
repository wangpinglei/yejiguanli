import { Eye, Megaphone, Users } from 'lucide-react';



import type {

  FinanceNoticeContent,

  FinanceNoticePushOptions,

} from '@/types/financeNoticeTypes';

import {

  Card,

  CardContent,

  CardDescription,

  CardHeader,

  CardTitle,

} from '@/components/ui/card';

import {

  Table,

  TableBody,

  TableCell,

  TableHead,

  TableHeader,

  TableRow,

} from '@/components/ui/table';



interface Props {

  content: FinanceNoticeContent;

  pushOptions: FinanceNoticePushOptions;

  isDraft?: boolean;

}



export default function MFinanceNoticePreview({

  content,

  pushOptions,

  isDraft = false,

}: Props) {

  const dutyRoster = content.dutyRoster.filter((row) => row.date || row.name || row.phone);

  const showNotice = pushOptions.pushIncludeNotice;

  const showDuty = pushOptions.pushIncludeDuty;

  const includeLabels: string[] = [];

  if (showNotice) includeLabels.push('通知');

  if (showDuty) includeLabels.push(`值班表${dutyRoster.length ? ` ${dutyRoster.length} 条` : ''}`);



  return (

    <Card className="border-blue-200/80 bg-blue-50/25">

      <CardHeader>

        <CardTitle className="flex items-center gap-2 text-lg text-blue-900">

          <Eye className="h-5 w-5" />

          推送内容预览

        </CardTitle>

        <CardDescription>

          以下为钉钉群将收到的内容

          {isDraft ? '（含当前未保存的修改）' : ''}

        </CardDescription>

        <p className="text-xs text-blue-800/80">

          本次推送：{includeLabels.length ? includeLabels.join('、') : '未选择任何板块'}

        </p>

      </CardHeader>

      <CardContent className="space-y-5 rounded-lg border border-blue-100 bg-white/90 p-4 text-sm leading-relaxed">

        {showNotice && (

          <section>

            <h3 className="mb-2 flex items-center gap-2 font-semibold">

              <Megaphone className="h-4 w-4 text-amber-600" />

              一、通知

            </h3>

            <p className="whitespace-pre-wrap text-foreground/90">

              {content.noticeText?.trim() || '（未填写通知内容）'}

            </p>

          </section>

        )}



        {showNotice && showDuty && <hr className="border-dashed" />}



        {showDuty && (

          <section>

            <h3 className="mb-2 flex items-center gap-2 font-semibold">

              <Users className="h-4 w-4" />

              二、值班表

            </h3>

            {dutyRoster.length > 0 ? (

              <Table>

                <TableHeader>

                  <TableRow>

                    <TableHead>值班日期</TableHead>

                    <TableHead>值班人员</TableHead>

                    <TableHead>联系电话</TableHead>

                  </TableRow>

                </TableHeader>

                <TableBody>

                  {dutyRoster.map((row, index) => (

                    <TableRow key={`${row.date}-${index}`}>

                      <TableCell>{row.date || '-'}</TableCell>

                      <TableCell>{row.name || '-'}</TableCell>

                      <TableCell>{row.phone || '-'}</TableCell>

                    </TableRow>

                  ))}

                </TableBody>

              </Table>

            ) : (

              <p className="text-muted-foreground">（未填写值班人员）</p>

            )}

          </section>

        )}



        {!showNotice && !showDuty && (

          <p className="text-muted-foreground">请勾选要推送的板块</p>

        )}

      </CardContent>

    </Card>

  );

}

