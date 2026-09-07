import { makeObservable, observable, observableRef, action } from 'mobx'
import type { ReactNode } from 'react'

class ModalStore {
  isOpen = false
  title: ReactNode = null
  content: ReactNode = null

  constructor() {
    makeObservable(this, {
      isOpen: observable,
      title: observableRef,
      content: observableRef,
      open: action,
      setTitle: action,
      close: action,
    })
  }

  open(content: ReactNode, title?: ReactNode) {
    this.content = content
    this.title = title ?? null
    this.isOpen = true
  }

  setTitle(title: ReactNode) {
    this.title = title
  }

  close() {
    this.isOpen = false
  }
}

export const modalStore = new ModalStore()
