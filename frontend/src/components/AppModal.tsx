import { observer } from 'mobx-react-lite'
import { Modal } from 'antd'
import { modalStore } from '../stores/modalStore'

export const AppModal = observer(() => {
  return (
    <Modal open={modalStore.isOpen} onCancel={() => modalStore.close()} title={modalStore.title} footer={null}>
      {modalStore.content}
    </Modal>
  )
})
