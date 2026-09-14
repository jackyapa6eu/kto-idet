import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Form, Input, DatePicker, TimePicker, InputNumber, Switch, Checkbox, Select, Button, Typography, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { eventsStore, type EventDetails } from '../stores/eventsStore'
import { modalStore } from '../stores/modalStore'
import { orgStore } from '../stores/orgStore'
import { templatesStore } from '../stores/templatesStore'

function disabledDate(date: Dayjs) {
  return date.isBefore(dayjs().startOf('day'))
}

interface EventFormValues {
  templatePicker?: number
  title: string
  location: string
  date: Dayjs
  time: Dayjs
  maxParticipants?: number
  trainer?: string
  price?: string
  court?: string
  paymentPhone?: string
  bank?: string
  comment?: string
  repeatWeekly?: boolean
  saveAsTemplate?: boolean
  templateName?: string
}

export const CreateEventForm = observer(({ event }: { event?: EventDetails }) => {
  const [form] = Form.useForm<EventFormValues>()
  const isEditing = event != null
  const saveAsTemplate = Form.useWatch('saveAsTemplate', form)

  useEffect(() => {
    if (!isEditing && eventsStore.organizationId != null) {
      templatesStore.fetchTemplates(eventsStore.organizationId)
    }
  }, [isEditing])

  const initialValues = event
    ? {
        title: event.title,
        location: event.location,
        date: dayjs(event.startsAt),
        time: dayjs(event.startsAt),
        maxParticipants: event.maxParticipants ?? undefined,
        trainer: event.trainer ?? undefined,
        price: event.price ?? undefined,
        court: event.court ?? undefined,
        paymentPhone: event.paymentPhone ?? undefined,
        bank: event.bank ?? undefined,
        comment: event.comment ?? undefined,
        repeatWeekly: event.repeatEveryDays != null,
      }
    : undefined

  const isPaid = orgStore.org?.isPaid ?? false
  const templateLimitReached = !isPaid && templatesStore.templates.length >= 1

  const handleTemplateSelect = (templateId: number) => {
    const template = templatesStore.templates.find((t) => t.id === templateId)
    if (!template) return
    form.setFieldsValue({
      title: template.title,
      location: template.location ?? undefined,
      maxParticipants: template.maxParticipants ?? undefined,
      trainer: template.trainer ?? undefined,
      price: template.price ?? undefined,
      court: template.court ?? undefined,
      paymentPhone: template.paymentPhone ?? undefined,
      bank: template.bank ?? undefined,
      comment: template.comment ?? undefined,
    })
  }

  const handleFinish = async (values: EventFormValues) => {
    const startsAt = values.date
      .hour(values.time.hour())
      .minute(values.time.minute())
      .second(0)
      .millisecond(0)

    const input = {
      title: values.title,
      location: values.location,
      startsAt: startsAt.toISOString(),
      maxParticipants: values.maxParticipants,
      trainer: values.trainer,
      price: values.price,
      court: values.court,
      paymentPhone: values.paymentPhone,
      bank: values.bank,
      comment: values.comment,
      repeatWeekly: values.repeatWeekly,
      saveAsTemplate: values.saveAsTemplate,
      templateName: values.templateName,
    }

    try {
      if (isEditing) {
        await eventsStore.updateEvent(event.id, input)
        message.success('Мероприятие обновлено')
      } else {
        await eventsStore.createEvent(input)
        message.success('Мероприятие создано')
        if (values.saveAsTemplate && eventsStore.organizationId != null) {
          await templatesStore.fetchTemplates(eventsStore.organizationId)
        }
        // AntD Modal по умолчанию не размонтирует контент при закрытии (нет destroyOnClose),
        // а modalStore.open() при следующем клике на "Создать" передаёт тот же тип компонента
        // без смены key — React переиспользует инстанс формы вместе со старыми значениями.
        form.resetFields()
      }
      modalStore.close()
    } catch (e) {
      const fallback = isEditing ? 'Не удалось обновить мероприятие' : 'Не удалось создать мероприятие'
      message.error(e instanceof Error ? e.message : fallback)
    }
  }

  return (
    <Form form={form} layout="vertical" initialValues={initialValues} onFinish={handleFinish}>
      {!isEditing && templatesStore.templates.length > 0 && (
        <Form.Item name="templatePicker" label="Начать с шаблона">
          <Select
            allowClear
            placeholder="Не выбран"
            options={templatesStore.templates.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(value) => value != null && handleTemplateSelect(value)}
          />
        </Form.Item>
      )}
      <Form.Item name="title" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
        <Input placeholder="Например, Вечерняя тренировка" />
      </Form.Item>
      <Form.Item name="location" label="Место" rules={[{ required: true, message: 'Укажите место' }]}>
        <Input placeholder="Например, Пляж «Ласточка»" />
      </Form.Item>
      <Form.Item name="date" label="Дата" rules={[{ required: true, message: 'Укажите дату' }]}>
        <DatePicker style={{ width: '100%' }} format="D MMMM" disabledDate={disabledDate} />
      </Form.Item>
      <Form.Item name="time" label="Время" rules={[{ required: true, message: 'Укажите время' }]}>
        <TimePicker style={{ width: '100%' }} format="HH:mm" />
      </Form.Item>
      <Form.Item name="trainer" label="Тренер">
        <Input placeholder="Необязательно" />
      </Form.Item>
      <Form.Item name="price" label="Стоимость">
        <Input placeholder="Необязательно" />
      </Form.Item>
      <Form.Item name="maxParticipants" label="Максимум участников">
        <InputNumber style={{ width: '100%' }} min={2} max={50} placeholder="Необязательно" />
      </Form.Item>
      <Form.Item name="court" label="Корт">
        <Input placeholder="Необязательно" />
      </Form.Item>
      <Form.Item name="paymentPhone" label="Перевод на номер" tooltip="Номер телефона для перевода, например 89031234567">
        <Input placeholder="Например, 89031234567" />
      </Form.Item>
      <Form.Item name="bank" label="Банк">
        <Input placeholder="Например Тбанк/Сбер/Альфа" />
      </Form.Item>
      <Form.Item name="comment" label="Комментарий">
        <Input.TextArea placeholder="Необязательно" autoSize={{ minRows: 2 }} />
      </Form.Item>
      <Form.Item
        name="repeatWeekly"
        label="Повторять каждую неделю"
        valuePropName="checked"
        extra={!isPaid && <Typography.Text type="secondary">Доступно на платном тарифе</Typography.Text>}
      >
        <Switch disabled={!isPaid} />
      </Form.Item>
      {!isEditing && (
        <>
          <Form.Item
            name="saveAsTemplate"
            valuePropName="checked"
            extra={
              templateLimitReached && (
                <Typography.Text type="secondary">
                  На бесплатном тарифе доступен только 1 шаблон — больше на платном
                </Typography.Text>
              )
            }
          >
            <Checkbox disabled={templateLimitReached}>Сохранить как шаблон</Checkbox>
          </Form.Item>
          {saveAsTemplate && (
            <Form.Item
              name="templateName"
              label="Название шаблона"
              rules={[{ required: true, message: 'Укажите название шаблона' }]}
            >
              <Input placeholder="Например, Вечерняя тренировка" />
            </Form.Item>
          )}
        </>
      )}
      <Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={isEditing ? eventsStore.updating : eventsStore.creating}
        >
          {isEditing ? 'Сохранить' : 'Создать'}
        </Button>
      </Form.Item>
    </Form>
  )
})
