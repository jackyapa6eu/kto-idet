import { observer } from 'mobx-react-lite'
import { Form, Input, DatePicker, TimePicker, InputNumber, Button, message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { eventsStore, type EventDetails } from '../stores/eventsStore'
import { modalStore } from '../stores/modalStore'

function disabledDate(date: Dayjs) {
  return date.isBefore(dayjs().startOf('day'))
}

interface EventFormValues {
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
}

export const CreateEventForm = observer(({ event }: { event?: EventDetails }) => {
  const [form] = Form.useForm<EventFormValues>()
  const isEditing = event != null

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
      }
    : undefined

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
    }

    try {
      if (isEditing) {
        await eventsStore.updateEvent(event.id, input)
        message.success('Мероприятие обновлено')
      } else {
        await eventsStore.createEvent(input)
        message.success('Мероприятие создано')
      }
      modalStore.close()
    } catch {
      message.error(isEditing ? 'Не удалось обновить мероприятие' : 'Не удалось создать мероприятие')
    }
  }

  return (
    <Form form={form} layout="vertical" initialValues={initialValues} onFinish={handleFinish}>
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
